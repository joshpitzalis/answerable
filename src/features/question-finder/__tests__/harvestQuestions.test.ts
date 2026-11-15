import { setImmediate } from "node:timers/promises";

import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import { SimulatedClock } from "xstate";

import type { Project } from "../domain";
import { EFFECT_PROJECT } from "../lib/projects.config";
import { Corpus } from "../services/corpus";
import { Cursors } from "../services/cursors";
import { Discord } from "../services/discord";
import { Judge } from "../services/judge";
import { QuestionStore } from "../services/question-store";
import { harvestQuestions } from "../workflows/harvestQuestions";
import { fakeDiscord } from "./discordWire.test-utils";

const XSTATE: Project = {
  channels: [
    { id: "x1", name: "xstate-help" },
    { id: "x2", name: "xstate-chat" },
  ],
  label: "XState",
  ownerName: "xena",
  serverId: "999",
  slug: "xstate",
};

// Judge.stub answers a question that shares a word of more than four letters with
// a Post title, so these titles make "actors" XState's and "layers" Effect's.
const corpus = Layer.succeed(
  Corpus,
  Corpus.of({
    all: (slug) =>
      Effect.succeed(
        slug === "xstate"
          ? [
              {
                body: "…",
                slug: "invoking-actors",
                title: "Invoking actors from a machine",
              },
            ]
          : [
              {
                body: "…",
                slug: "layers-once",
                title: "Building Effect layers once",
              },
            ]
      ),
  })
);

const storeThatCannotSave = Layer.succeed(
  QuestionStore,
  QuestionStore.of({
    listOpen: () => Effect.succeed([]),
    save: () => Effect.die(new Error("disk full")),
  })
);

const runtimeOver = (
  fetch: typeof globalThis.fetch,
  store: Layer.Layer<QuestionStore> = QuestionStore.stub
) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      Discord.layer("token", fetch),
      Cursors.stub,
      corpus,
      Judge.stub,
      store
    )
  );

const storedIds = async (
  runtime: ReturnType<typeof runtimeOver>,
  project: Project
) => {
  const rows = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* QuestionStore;

      return yield* store.listOpen(project.slug);
    })
  );

  return rows.map((row) => row.id);
};

const cursorOf = async (
  runtime: ReturnType<typeof runtimeOver>,
  channelId: string
) => {
  const cursor = await runtime.runPromise(
    Effect.gen(function* () {
      const cursors = yield* Cursors;

      return yield* cursors.get(channelId);
    })
  );

  return Option.getOrNull(cursor);
};

const twoChannelsWithOneQuestion = () =>
  fakeDiscord({
    channels: {
      x1: [
        { content: "How do actors get stopped?", id: "100" },
        { content: "Actors are great.", id: "200" },
        { content: "What is the best pizza topping?", id: "300" },
      ],
      x2: [],
    },
  });

/** Lets promises and the Effect runtime run; the simulated clock never does. */
const settle = async () => {
  for (let tick = 0; tick < 50; tick += 1) {
    // oxlint-disable-next-line no-await-in-loop -- ticks must run one after another
    await setImmediate();
  }
};

describe("a rate-limited Channel", () => {
  it("waits as long as Discord asks, then retries and saves its questions", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [{ content: "How do actors get stopped?", id: "100" }],
        x2: [{ content: "How do actors get spawned?", id: "200" }],
      },
      limited: { x1: { retryAfterSeconds: 2.5, times: 1 } },
    });

    const clock = new SimulatedClock();
    const runtime = runtimeOver(wire.fetch);

    const done = harvestQuestions(runtime, XSTATE, clock);

    await settle();
    // The sibling is not held up by the waiting Channel.
    await expect(storedIds(runtime, XSTATE)).resolves.toStrictEqual(["200"]);

    clock.increment(2500);
    await expect(done).resolves.toStrictEqual([]);
    const stored = await storedIds(runtime, XSTATE);

    expect(stored.toSorted()).toStrictEqual(["100", "200"]);
    await expect(cursorOf(runtime, "x1")).resolves.toBe("100");
  });

  it("does not retry before the delay Discord asked for has passed", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [{ content: "How do actors get stopped?", id: "100" }],
        x2: [],
      },
      limited: { x1: { retryAfterSeconds: 2.5, times: 1 } },
    });

    const clock = new SimulatedClock();
    const runtime = runtimeOver(wire.fetch);

    const done = harvestQuestions(runtime, XSTATE, clock);

    await settle();
    clock.increment(2499);
    await settle();

    expect(wire.requestsTo["x1"]).toBe(1);

    clock.increment(1);
    await done;

    expect(wire.requestsTo["x1"]).toBe(2);
  });

  it("retries the step it was limited in, not the whole Channel", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [{ content: "How do actors get stopped?", id: "100" }],
        x2: [],
      },
      limited: { "100": { retryAfterSeconds: 1, times: 1 } },
    });

    const clock = new SimulatedClock();
    const runtime = runtimeOver(wire.fetch);

    const done = harvestQuestions(runtime, XSTATE, clock);

    await settle();
    clock.increment(1000);

    await expect(done).resolves.toStrictEqual([]);
    expect(wire.requestsTo["x1"]).toBe(1);
    await expect(storedIds(runtime, XSTATE)).resolves.toStrictEqual(["100"]);
  });

  it("is reported as rate-limited after 2 retries, with its cursor where it was", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [{ content: "How do actors get stopped?", id: "100" }],
        x2: [{ content: "How do actors get spawned?", id: "200" }],
      },
      limited: { x1: { retryAfterSeconds: 1, times: 3 } },
    });

    const clock = new SimulatedClock();
    const runtime = runtimeOver(wire.fetch);

    const done = harvestQuestions(runtime, XSTATE, clock);

    await settle();
    clock.increment(1000);
    await settle();
    clock.increment(1000);

    await expect(done).resolves.toStrictEqual([
      {
        name: "xstate-help",
        reason: "Rate-limited by Discord: still limited after 2 retries",
      },
    ]);
    expect(wire.requestsTo["x1"]).toBe(3);
    await expect(storedIds(runtime, XSTATE)).resolves.toStrictEqual(["200"]);
    await expect(cursorOf(runtime, "x1")).resolves.toBeNull();
  });

  it("shares the 2-retry budget between its steps", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [{ content: "How do actors get stopped?", id: "100" }],
        x2: [],
      },
      limited: {
        "100": { retryAfterSeconds: 1, times: 2 },
        x1: { retryAfterSeconds: 1, times: 1 },
      },
    });

    const clock = new SimulatedClock();
    const runtime = runtimeOver(wire.fetch);

    const done = harvestQuestions(runtime, XSTATE, clock);

    await settle();
    clock.increment(1000);
    await settle();
    clock.increment(1000);

    await expect(done).resolves.toStrictEqual([
      {
        name: "xstate-help",
        reason: "Rate-limited by Discord: still limited after 2 retries",
      },
    ]);
    await expect(cursorOf(runtime, "x1")).resolves.toBeNull();
  });
});

describe(harvestQuestions, () => {
  it("reports a Channel whose wire fails and still saves its sibling's questions", async () => {
    const wire = fakeDiscord({
      broken: ["x2"],
      channels: {
        x1: [{ content: "How do actors get stopped?", id: "100" }],
        x2: [{ content: "How do actors get spawned?", id: "200" }],
      },
    });

    const runtime = runtimeOver(wire.fetch);

    const failed = await harvestQuestions(runtime, XSTATE);

    expect(failed).toStrictEqual([
      {
        name: "xstate-chat",
        reason: "GET /channels/x2/messages?limit=10 returned 500",
      },
    ]);
    await expect(storedIds(runtime, XSTATE)).resolves.toStrictEqual(["100"]);
  });

  it("leaves the cursor where it was when a step before saving fails", async () => {
    const wire = fakeDiscord({
      broken: ["100"],
      channels: { x1: [{ content: "How do actors get stopped?", id: "100" }] },
    });

    const runtime = runtimeOver(wire.fetch);

    const failed = await harvestQuestions(runtime, {
      ...XSTATE,
      channels: [{ id: "x1", name: "xstate-help" }],
    });

    expect(failed.map((channel) => channel.name)).toStrictEqual([
      "xstate-help",
    ]);
    await expect(cursorOf(runtime, "x1")).resolves.toBeNull();
  });

  it("leaves the cursor where it was when saving fails", async () => {
    const wire = fakeDiscord({
      channels: { x1: [{ content: "How do actors get stopped?", id: "100" }] },
    });

    const runtime = runtimeOver(wire.fetch, storeThatCannotSave);

    const failed = await harvestQuestions(runtime, {
      ...XSTATE,
      channels: [{ id: "x1", name: "xstate-help" }],
    });

    expect(failed.map((channel) => channel.name)).toStrictEqual([
      "xstate-help",
    ]);
    await expect(cursorOf(runtime, "x1")).resolves.toBeNull();
  });

  it("advances the cursor to the newest message read", async () => {
    const runtime = runtimeOver(twoChannelsWithOneQuestion().fetch);

    const failed = await harvestQuestions(runtime, XSTATE);

    expect(failed).toStrictEqual([]);
    await expect(cursorOf(runtime, "x1")).resolves.toBe("300");
    await expect(cursorOf(runtime, "x2")).resolves.toBeNull();
  });

  it("keeps earlier questions listed when a second run reads nothing new", async () => {
    const runtime = runtimeOver(twoChannelsWithOneQuestion().fetch);

    await harvestQuestions(runtime, XSTATE);
    const second = await harvestQuestions(runtime, XSTATE);

    expect(second).toStrictEqual([]);
    await expect(cursorOf(runtime, "x1")).resolves.toBe("300");
    await expect(storedIds(runtime, XSTATE)).resolves.toStrictEqual(["100"]);
  });

  it("reads only the requested Project's Channels", async () => {
    const wire = fakeDiscord({
      channels: {
        "1125094089281511474": [{ content: "Why layers?", id: "900" }],
        x1: [],
        x2: [],
      },
    });

    const runtime = runtimeOver(wire.fetch);

    await harvestQuestions(runtime, XSTATE);

    expect(wire.channelsRead.toSorted()).toStrictEqual(["x1", "x2"]);
  });

  it("keeps a question only when it matches a Post of its own Project", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          { content: "How do actors get stopped?", id: "100" },
          { content: "How do I build layers once?", id: "200" },
        ],
        x2: [],
      },
    });

    const runtime = runtimeOver(wire.fetch);

    await harvestQuestions(runtime, XSTATE);

    await expect(storedIds(runtime, XSTATE)).resolves.toStrictEqual(["100"]);
    await expect(storedIds(runtime, EFFECT_PROJECT)).resolves.toStrictEqual([]);
  });

  it("leaves out a thread the owner replied to under that Project's display name", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          { content: "How do actors get stopped?", id: "100" },
          { content: "Why are machine actors lazy?", id: "200" },
        ],
        x2: [],
      },
      // "josh" is the Effect owner's name: it must not count in the XState Project.
      replies: { "100": ["xena"], "200": ["josh"] },
    });

    const runtime = runtimeOver(wire.fetch);

    await harvestQuestions(runtime, XSTATE);

    await expect(storedIds(runtime, XSTATE)).resolves.toStrictEqual(["200"]);
  });
});
