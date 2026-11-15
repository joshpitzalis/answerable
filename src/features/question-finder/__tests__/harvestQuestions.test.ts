import { setImmediate } from "node:timers/promises";

import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import { SimulatedClock } from "xstate";

import type { Project } from "../domain";
import { EFFECT_PROJECT } from "../lib/projects.config.example";
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

/** Wired the way `src/app/runtime.ts` wires a bound Discord token. */
const liveRuntimeOver = (fetch: typeof globalThis.fetch) =>
  ManagedRuntime.make(
    Layer.mergeAll(
      Discord.layerSkippingReplyCheck("token", fetch),
      Cursors.stub,
      corpus,
      Judge.everythingAnswerable,
      QuestionStore.stub
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

const FORUM_PROJECT: Project = {
  ...XSTATE,
  channels: [{ id: "f1", name: "xstate-forum" }],
};

const rowsOf = (runtime: ReturnType<typeof runtimeOver>, project: Project) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* QuestionStore;

      return yield* store.listOpen(project.slug);
    })
  );

const threePosts = () =>
  fakeDiscord({
    channels: {},
    forums: {
      f1: [
        {
          content: "How do I stop one?",
          id: "100",
          replyCount: 3,
          title: "Stopping actors",
        },
        {
          content: "I call stop and nothing happens.",
          id: "200",
          title: "Actors never stop",
        },
        {
          content: "Is it a bug?",
          id: "300",
          title: "Spawned actors vanish",
        },
      ],
    },
  });

/** `count` posts, ids 1000 upward, oldest first. */
const manyPosts = (count: number) =>
  fakeDiscord({
    channels: {},
    forums: {
      f1: Array.from({ length: count }, (_, index) => ({
        content: "Why?",
        id: `${1000 + index}`,
        title: `Actors stop ${index}`,
      })),
    },
  });

describe("a forum Channel", () => {
  it("is saved as questions carrying the post's title, link and reply count", async () => {
    const runtime = runtimeOver(threePosts().fetch);

    await expect(
      harvestQuestions(runtime, FORUM_PROJECT)
    ).resolves.toStrictEqual([]);

    const rows = await rowsOf(runtime, FORUM_PROJECT);
    const first = rows.find((row) => row.id === "100");

    expect(first).toMatchObject({
      comments: 3,
      id: "100",
      name: "ada",
      question: "Stopping actors\n\nHow do I stop one?",
      url: "https://discord.com/channels/wire-guild/100",
    });
    expect(first?.dateAsked).toStrictEqual(new Date("2026-08-01T00:00:00Z"));
  });

  it("keeps a post whose text has no question mark", async () => {
    const runtime = runtimeOver(threePosts().fetch);

    await harvestQuestions(runtime, FORUM_PROJECT);

    const stored = await storedIds(runtime, FORUM_PROJECT);

    expect(stored.toSorted()).toStrictEqual(["100", "200", "300"]);
  });

  it("reads only posts newer than the cursor and advances it to the newest post", async () => {
    const runtime = runtimeOver(threePosts().fetch);

    await runtime.runPromise(
      Cursors.use((cursors) => cursors.set("f1", "200"))
    );

    await harvestQuestions(runtime, FORUM_PROJECT);

    await expect(storedIds(runtime, FORUM_PROJECT)).resolves.toStrictEqual([
      "300",
    ]);
    await expect(cursorOf(runtime, "f1")).resolves.toBe("300");
  });

  it("asks Discord for the Channel's kind and its active posts on a first run, and for the posts and replies only on a second", async () => {
    const wire = threePosts();
    const runtime = runtimeOver(wire.fetch);

    await harvestQuestions(runtime, FORUM_PROJECT);

    expect(wire.requestLog).toStrictEqual([
      "/api/v9/channels/f1",
      "/api/v9/channels/f1/threads/search?archived=false&sort_by=creation_time&sort_order=desc&limit=25&offset=0",
      "/api/v9/channels/100/messages?limit=10",
      "/api/v9/channels/200/messages?limit=10",
      "/api/v9/channels/300/messages?limit=10",
    ]);

    wire.requestLog.length = 0;
    await expect(
      harvestQuestions(runtime, FORUM_PROJECT)
    ).resolves.toStrictEqual([]);

    expect(wire.requestLog).toStrictEqual([
      "/api/v9/channels/f1/threads/search?archived=false&sort_by=creation_time&sort_order=desc&limit=25&offset=0",
    ]);
    await expect(storedIds(runtime, FORUM_PROJECT)).resolves.toHaveLength(3);
  });

  it("skips a post that has no first message and keeps the rest", async () => {
    const wire = fakeDiscord({
      channels: {},
      forums: {
        f1: [
          {
            content: "gone",
            id: "100",
            title: "Actors",
            withoutFirstMessage: true,
          },
          { content: "Why?", id: "200", title: "Actors stop" },
        ],
      },
    });

    const runtime = runtimeOver(wire.fetch);

    await expect(
      harvestQuestions(runtime, FORUM_PROJECT)
    ).resolves.toStrictEqual([]);
    await expect(storedIds(runtime, FORUM_PROJECT)).resolves.toStrictEqual([
      "200",
    ]);
  });

  it("waits out a rate limit on the post listing like any other", async () => {
    const wire = fakeDiscord({
      channels: {},
      forums: {
        f1: [{ content: "Why?", id: "100", title: "Actors stop" }],
      },
      limited: { f1: { retryAfterSeconds: 2, times: 1 } },
    });

    const clock = new SimulatedClock();
    const runtime = runtimeOver(wire.fetch);

    const done = harvestQuestions(runtime, FORUM_PROJECT, clock);

    await settle();
    await expect(storedIds(runtime, FORUM_PROJECT)).resolves.toStrictEqual([]);

    clock.increment(2000);

    await expect(done).resolves.toStrictEqual([]);
    await expect(storedIds(runtime, FORUM_PROJECT)).resolves.toStrictEqual([
      "100",
    ]);
  });

  it("waits out a rate limit on the kind lookup, then asks only once more", async () => {
    const wire = fakeDiscord({
      channels: {},
      forums: {
        f1: [{ content: "Why?", id: "100", title: "Actors stop" }],
      },
      limited: { "kind:f1": { retryAfterSeconds: 1, times: 1 } },
    });

    const clock = new SimulatedClock();
    const runtime = runtimeOver(wire.fetch);

    const done = harvestQuestions(runtime, FORUM_PROJECT, clock);

    await settle();
    clock.increment(1000);

    await expect(done).resolves.toStrictEqual([]);
    expect(wire.requestsTo["kind:f1"]).toBe(2);
    await expect(storedIds(runtime, FORUM_PROJECT)).resolves.toStrictEqual([
      "100",
    ]);
  });

  it("reports a Channel whose kind cannot be read", async () => {
    const wire = fakeDiscord({
      broken: ["kind:f1"],
      channels: {},
      forums: { f1: [] },
    });

    await expect(
      harvestQuestions(runtimeOver(wire.fetch), FORUM_PROJECT)
    ).resolves.toStrictEqual([
      { name: "xstate-forum", reason: "GET /channels/f1 returned 500" },
    ]);
  });

  it("reports a Channel whose post listing fails", async () => {
    const wire = fakeDiscord({
      broken: ["f1"],
      channels: {},
      forums: { f1: [] },
    });

    const failed = await harvestQuestions(
      runtimeOver(wire.fetch),
      FORUM_PROJECT
    );

    expect(failed.map((channel) => channel.name)).toStrictEqual([
      "xstate-forum",
    ]);
  });

  it("reads a second page of posts when the first is full of new ones, and saves posts from both", async () => {
    const wire = manyPosts(30);
    const runtime = runtimeOver(wire.fetch);

    await expect(
      harvestQuestions(runtime, FORUM_PROJECT)
    ).resolves.toStrictEqual([]);

    expect(
      wire.requestLog.filter((path) => path.includes("threads/search"))
    ).toStrictEqual([
      "/api/v9/channels/f1/threads/search?archived=false&sort_by=creation_time&sort_order=desc&limit=25&offset=0",
      "/api/v9/channels/f1/threads/search?archived=false&sort_by=creation_time&sort_order=desc&limit=25&offset=25",
    ]);

    const stored = await storedIds(runtime, FORUM_PROJECT);

    expect(stored).toHaveLength(30);
    expect(stored).toContain("1029");
    expect(stored).toContain("1000");
  });

  it("reads at most the 50 newest posts", async () => {
    const runtime = runtimeOver(manyPosts(60).fetch);

    await harvestQuestions(runtime, FORUM_PROJECT);

    const stored = await storedIds(runtime, FORUM_PROJECT);

    expect(stored).toHaveLength(50);
    expect(stored).toContain("1059");
    expect(stored).toContain("1010");
    expect(stored).not.toContain("1009");
  });

  it("does not read a second page when the first already reaches the cursor", async () => {
    const wire = manyPosts(30);
    const runtime = runtimeOver(wire.fetch);

    // Posts 1011 to 1029 are newer; the first page of 25 runs back to 1005.
    await runtime.runPromise(
      Cursors.use((cursors) => cursors.set("f1", "1010"))
    );

    await harvestQuestions(runtime, FORUM_PROJECT);

    expect(
      wire.requestLog.filter((path) => path.includes("threads/search"))
    ).toHaveLength(1);
    await expect(storedIds(runtime, FORUM_PROJECT)).resolves.toHaveLength(19);
  });

  it("is read beside a text Channel, which still needs its question mark", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          { content: "How do actors get stopped?", id: "100" },
          { content: "Actors are great.", id: "150" },
        ],
      },
      forums: {
        f1: [{ content: "It never stops.", id: "200", title: "Actors hang" }],
      },
    });

    const runtime = runtimeOver(wire.fetch);

    await harvestQuestions(runtime, {
      ...XSTATE,
      channels: [
        { id: "x1", name: "xstate-help" },
        { id: "f1", name: "xstate-forum" },
      ],
    });

    const stored = await storedIds(runtime, XSTATE);

    expect(stored.toSorted()).toStrictEqual(["100", "200"]);
  });
});

describe(harvestQuestions, () => {
  it("asks a text Channel for its 50 newest messages", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: Array.from({ length: 60 }, (_, index) => ({
          content: `How do actors work, part ${index}?`,
          id: `${1000 + index}`,
        })),
        x2: [],
      },
    });

    const runtime = runtimeOver(wire.fetch);

    await harvestQuestions(runtime, XSTATE);

    expect(wire.requestLog).toContain("/api/v9/channels/x1/messages?limit=50");

    const stored = await storedIds(runtime, XSTATE);

    expect(stored).toHaveLength(50);
    expect(stored).toContain("1059");
    expect(stored).not.toContain("1009");
  });

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
        reason: "GET /channels/x2/messages?limit=50 returned 500",
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

  it("finishes at once for a Project with no Channels", async () => {
    const wire = fakeDiscord({ channels: {} });
    const runtime = runtimeOver(wire.fetch);

    await expect(
      harvestQuestions(runtime, { ...XSTATE, channels: [] })
    ).resolves.toStrictEqual([]);
    expect(wire.channelsRead).toStrictEqual([]);
  });

  it("judges at most 4 questions of a Channel at a time", async () => {
    let inFlight = 0;
    let mostInFlight = 0;

    const slowJudge = Layer.succeed(
      Judge,
      Judge.of({
        answerable: () =>
          Effect.gen(function* () {
            inFlight += 1;
            mostInFlight = Math.max(mostInFlight, inFlight);
            yield* Effect.sleep("20 millis");
            inFlight -= 1;

            return { answerable: true };
          }),
      })
    );

    const wire = fakeDiscord({
      channels: {
        x1: Array.from({ length: 6 }, (_, index) => ({
          content: `How do actors work, part ${index}?`,
          id: `${100 + index}`,
        })),
      },
    });

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        Discord.layer("token", wire.fetch),
        Cursors.stub,
        corpus,
        slowJudge,
        QuestionStore.stub
      )
    );

    await harvestQuestions(runtime, {
      ...XSTATE,
      channels: [{ id: "x1", name: "xstate-help" }],
    });

    expect(mostInFlight).toBe(4);
    await expect(storedIds(runtime, XSTATE)).resolves.toHaveLength(6);
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

  it("keeps a question that matches no Post when wired the live way", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          { content: "How do actors get stopped?", id: "100" },
          { content: "What is the best pizza topping?", id: "200" },
          { content: "Just chatting.", id: "300" },
        ],
        x2: [],
      },
    });

    const runtime = liveRuntimeOver(wire.fetch);

    await harvestQuestions(runtime, XSTATE);

    const stored = await storedIds(runtime, XSTATE);

    expect(stored.toSorted()).toStrictEqual(["100", "200"]);
  });

  it("makes no reply-check request and keeps a thread the owner replied to when wired the live way", async () => {
    const wire = fakeDiscord({
      channels: {
        x1: [
          { content: "How do actors get stopped?", id: "100" },
          { content: "Why are machine actors lazy?", id: "200" },
        ],
        x2: [],
      },
      replies: { "100": ["xena"] },
    });

    const runtime = liveRuntimeOver(wire.fetch);

    await harvestQuestions(runtime, XSTATE);

    expect(wire.requestsTo["100"]).toBeUndefined();
    expect(wire.requestsTo["200"]).toBeUndefined();

    const stored = await storedIds(runtime, XSTATE);

    expect(stored.toSorted()).toStrictEqual(["100", "200"]);
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
