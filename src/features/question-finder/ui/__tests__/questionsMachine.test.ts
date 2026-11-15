import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";

import type { QuestionsRow } from "../../domain";
import { createQuestionsMachine } from "../questionsMachine";

const row: QuestionsRow = {
  id: "1",
  name: "Ada",
  comments: 2,
  question: "How do I retry an Effect?",
  dateAsked: new Date("2026-01-01T00:00:00Z"),
  url: "https://discord.com/channels/1/2/3",
};

const timeout = { timeout: 1000 };

describe("questions machine", () => {
  it("starts in loading and reaches loaded with the questions", async () => {
    const actor = createActor(
      createQuestionsMachine(() => Promise.resolve([row]))
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
          : Promise.resolve([row]);
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

        return Promise.resolve([row]);
      })
    ).start();

    await waitFor(actor, (s) => s.matches("loaded"), timeout);

    actor.send({ type: "retry" });

    expect(actor.getSnapshot().matches("loaded")).toBeTruthy();
    expect(calls).toBe(1);
  });
});
