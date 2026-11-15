import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";

import type { QuestionsReply, QuestionsRow } from "../../domain";
import { createQuestionsMachine } from "../questionsMachine";

const row: QuestionsRow = {
  id: "1",
  project: "effect",
  channel: { id: "2", name: "effect-help" },
  name: "Ada",
  comments: 2,
  question: "How do I retry an Effect?",
  isPost: false,
  dateAsked: new Date("2026-01-01T00:00:00Z"),
  url: "https://discord.com/channels/1/2/3",
};

const reply: QuestionsReply = {
  failedChannels: [{ name: "effect-chat", reason: "GET /x returned 401" }],
  questions: [row],
};

const timeout = { timeout: 1000 };

describe("questions machine", () => {
  it("keeps the failed Channels the server reported", async () => {
    const actor = createActor(
      createQuestionsMachine(() => Promise.resolve(reply))
    ).start();

    const snapshot = await waitFor(actor, (s) => s.matches("loaded"), timeout);

    expect(snapshot.context.failedChannels).toStrictEqual([
      { name: "effect-chat", reason: "GET /x returned 401" },
    ]);
  });

  it("starts in loading and reaches loaded with the questions", async () => {
    const actor = createActor(
      createQuestionsMachine(() => Promise.resolve(reply))
    ).start();

    expect(actor.getSnapshot().matches("loading")).toBeTruthy();
    const snapshot = await waitFor(actor, (s) => s.matches("loaded"), timeout);

    expect(snapshot.context.questions).toStrictEqual([row]);
  });

  it("reaches failed with the reason when the server call rejects", async () => {
    const actor = createActor(
      createQuestionsMachine(() => Promise.reject(new Error("Discord is down")))
    ).start();

    const snapshot = await waitFor(actor, (s) => s.matches("failed"), timeout);

    expect(snapshot.context.reason).toBe("Discord is down");
  });

  it("retry in failed returns to loading and can then load", async () => {
    let calls = 0;

    const actor = createActor(
      createQuestionsMachine(() => {
        calls += 1;

        return calls === 1
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(reply);
      })
    ).start();

    await waitFor(actor, (s) => s.matches("failed"), timeout);

    actor.send({ type: "retry" });
    expect(actor.getSnapshot().matches("loading")).toBeTruthy();
    expect(actor.getSnapshot().context.reason).toBeNull();

    const snapshot = await waitFor(actor, (s) => s.matches("loaded"), timeout);
    expect(snapshot.context.questions).toStrictEqual([row]);
    expect(calls).toBe(2);
  });

  it("ignores retry while loaded", async () => {
    let calls = 0;

    const actor = createActor(
      createQuestionsMachine(() => {
        calls += 1;

        return Promise.resolve(reply);
      })
    ).start();

    await waitFor(actor, (s) => s.matches("loaded"), timeout);

    actor.send({ type: "retry" });

    expect(actor.getSnapshot().matches("loaded")).toBeTruthy();
    expect(calls).toBe(1);
  });
});
