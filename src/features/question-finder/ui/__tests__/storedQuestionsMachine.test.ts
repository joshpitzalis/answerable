import { describe, expect, it, vi } from "vitest";
import { createActor, SimulatedClock, waitFor } from "xstate";

import type { StoredQuestionsReply } from "../../domain/harvest.values";
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

  it("retains saved data when Refresh fails and stops polling on read failure", async () => {
    const clock = new SimulatedClock();

    const load = vi
      .fn<() => Promise<StoredQuestionsReply>>()
      .mockResolvedValueOnce(saved("current"))
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
    expect(actor.getSnapshot().context.harvest?.status).toBe("current");
    expect(actor.getSnapshot().context.reason).toBe("Refresh unavailable");
    actor.send({ type: "refresh" });
    await waitFor(actor, (s) => s.matches("waiting"), timeout);
    clock.increment(2000);
    await waitFor(actor, (s) => s.matches("failed"), timeout);
    clock.increment(6000);
    expect(load).toHaveBeenCalledTimes(2);
    actor.stop();
  });

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
