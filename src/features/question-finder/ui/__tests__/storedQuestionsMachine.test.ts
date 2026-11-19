import { describe, expect, it, vi } from "vitest";
import { createActor, SimulatedClock, waitFor } from "xstate";

import type { StoredQuestionsReply } from "../../domain/values/harvest.values";
import { createQuestionsMachine } from "../questionsMachine";

const saved = (
  status: StoredQuestionsReply["harvest"]["status"]
): StoredQuestionsReply => ({
  questions: [],
  failedChannels: [],
  contributorStats: null,
  harvest: {
    status,
    activatedAt: null,
    lastAttempt: null,
    lastCompleteSuccess: null,
    initialCoverage: "latest-50",
    pendingProcessing: 0,
    nextEligibleAt: null,
  },
});

const timeout = { timeout: 1000 };

describe("saved questions lifecycle", () => {
  it("refuses Refresh while the saved collection is suspended", async () => {
    const actor = createActor(
      createQuestionsMachine({
        load: () => Promise.resolve(saved("suspended")),
        activate: () => Promise.resolve(saved("working")),
        refresh: () => Promise.resolve(saved("working")),
      })
    ).start();

    await waitFor(actor, (state) => state.matches("loaded"), timeout);
    actor.send({ type: "refresh" });
    expect(actor.getSnapshot().matches("loaded")).toBeTruthy();
    expect(actor.getSnapshot().context.harvest?.status).toBe("suspended");
    actor.stop();
  });

  it("retains the saved new-state read when activation fails", async () => {
    const initial = saved("new");

    const actor = createActor(
      createQuestionsMachine({
        load: () => Promise.resolve(initial),
        activate: () => Promise.reject(new Error("Activation unavailable")),
        refresh: () => Promise.resolve(saved("working")),
      })
    ).start();

    const failed = await waitFor(
      actor,
      (state) => state.matches("failed"),
      timeout
    );

    expect(failed.context.harvest).toStrictEqual(initial.harvest);
    expect(failed.context.reason).toBe("Activation unavailable");
    actor.send({ type: "refresh" });
    expect(actor.getSnapshot().matches("failed")).toBeTruthy();
    expect(actor.getSnapshot().context.reason).toBe("Activation unavailable");
    actor.stop();
  });

  it("refreshes a partial collection while keeping its saved rows visible", async () => {
    const partial: StoredQuestionsReply = {
      ...saved("partial"),
      questions: [
        {
          id: "101",
          project: "effect",
          channel: { id: "800", name: "Help" },
          name: "Writer",
          comments: 0,
          question: "Can this resume?",
          isPost: false,
          avatarUrl: null,
          dateAsked: new Date(0),
          url: "https://example.com/question",
        },
      ],
    };

    const actor = createActor(
      createQuestionsMachine({
        load: () => Promise.resolve(partial),
        activate: () => Promise.resolve(saved("working")),
        refresh: () =>
          Promise.resolve({
            ...partial,
            harvest: { ...partial.harvest, status: "current" },
          }),
      })
    ).start();

    await waitFor(actor, (s) => s.matches("loaded"), timeout);
    actor.send({ type: "refresh" });
    expect(actor.getSnapshot().matches("refreshing")).toBeTruthy();
    expect(actor.getSnapshot().context.questions).toStrictEqual(
      partial.questions
    );
    const done = await waitFor(actor, (s) => s.matches("loaded"), timeout);
    expect(done.context.harvest?.status).toBe("current");
    expect(done.context.questions).toStrictEqual(partial.questions);
    actor.stop();
  });

  it("leaves partial results available without polling or activating again", async () => {
    const clock = new SimulatedClock();

    const load = vi
      .fn<() => Promise<StoredQuestionsReply>>()
      .mockResolvedValue(saved("partial"));

    const activate = vi.fn<() => Promise<StoredQuestionsReply>>();

    const actor = createActor(
      createQuestionsMachine({
        load,
        activate,
        refresh: vi.fn<() => Promise<StoredQuestionsReply>>(),
      }),
      { clock }
    ).start();

    await waitFor(actor, (s) => s.matches("loaded"), timeout);
    clock.increment(6000);
    expect(load).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    actor.stop();
  });

  it("activates only after a new saved read and polls every two seconds until current", async () => {
    const clock = new SimulatedClock();

    const load = vi
      .fn<() => Promise<StoredQuestionsReply>>()
      .mockResolvedValueOnce(saved("new"))
      .mockResolvedValue(saved("current"));

    const activate = vi
      .fn<() => Promise<StoredQuestionsReply>>()
      .mockResolvedValue(saved("working"));

    const refresh = vi.fn<() => Promise<StoredQuestionsReply>>();

    const actor = createActor(
      createQuestionsMachine({ load, activate, refresh }),
      { clock }
    ).start();

    await waitFor(actor, (s) => s.matches("waiting"), timeout);
    expect(activate).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    clock.increment(1999);
    expect(load).toHaveBeenCalledOnce();
    clock.increment(1);
    await waitFor(actor, (s) => s.matches("loaded"), timeout);
    clock.increment(6000);
    expect(load).toHaveBeenCalledTimes(2);
    actor.stop();
  });

  it.each(["current", "partial"] as const)(
    "retains %s data when Refresh fails and permits another Refresh",
    async (status) => {
      const clock = new SimulatedClock();

      const load = vi
        .fn<() => Promise<StoredQuestionsReply>>()
        .mockResolvedValueOnce(saved(status))
        .mockRejectedValue(new Error("Read unavailable"));

      const refresh = vi
        .fn<() => Promise<StoredQuestionsReply>>()
        .mockRejectedValueOnce(new Error("Refresh unavailable"))
        .mockResolvedValue(saved("waiting"));

      const actor = createActor(
        createQuestionsMachine({
          load,
          refresh,
          activate: vi.fn<() => Promise<StoredQuestionsReply>>(),
        }),
        { clock }
      ).start();

      await waitFor(actor, (s) => s.matches("loaded"), timeout);
      actor.send({ type: "refresh" });
      await waitFor(actor, (s) => s.matches("failed"), timeout);
      expect(actor.getSnapshot().context.harvest?.status).toBe(status);
      expect(actor.getSnapshot().context.reason).toBe("Refresh unavailable");
      actor.send({ type: "refresh" });
      await waitFor(actor, (s) => s.matches("waiting"), timeout);
      clock.increment(2000);
      await waitFor(actor, (s) => s.matches("failed"), timeout);
      clock.increment(6000);
      expect(load).toHaveBeenCalledTimes(2);
      actor.stop();
    }
  );

  it("stops timers when the view unmounts without cancelling durable work", async () => {
    const clock = new SimulatedClock();

    const load = vi
      .fn<() => Promise<StoredQuestionsReply>>()
      .mockResolvedValue(saved("working"));

    const actor = createActor(
      createQuestionsMachine({
        load,
        refresh: vi.fn<() => Promise<StoredQuestionsReply>>(),
        activate: vi.fn<() => Promise<StoredQuestionsReply>>(),
      }),
      { clock }
    ).start();

    await waitFor(actor, (s) => s.matches("waiting"), timeout);
    actor.stop();
    clock.increment(6000);
    expect(load).toHaveBeenCalledOnce();
  });
});
