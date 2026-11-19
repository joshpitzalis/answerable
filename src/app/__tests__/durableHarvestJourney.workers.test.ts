import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../../features/question-finder/domain";
import {
  EFFECT_PROJECT,
  XSTATE_PROJECT,
} from "../../features/question-finder/lib/projects.config.example";
import { Corpus } from "../../features/question-finder/services/corpus";
import {
  Discord,
  DiscordFailed,
} from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { ScheduledHarvest } from "../../features/question-finder/workflows/scheduledHarvest";
import { projectHarvestStub } from "../projectHarvest";
import type { ProjectHarvest } from "../projectHarvest";

const complete = async (
  stub: DurableObjectStub<ProjectHarvest>,
  project: Project
) => {
  let saved = await stub.read(project);
  let batches = 0;

  while (saved.harvest.status !== "current" && batches < 40) {
    vi.setSystemTime(saved.harvest.nextEligibleAt ?? Date.now() + 1000);
    // oxlint-disable-next-line no-await-in-loop -- Deliver each committed continuation in order.
    await runDurableObjectAlarm(stub);
    // oxlint-disable-next-line no-await-in-loop -- Completion is observable through the native read boundary.
    saved = await stub.read(project);
    batches += 1;
  }

  expect(saved.harvest.status).toBe("current");

  for (const question of saved.questions) {
    expect(question.url).toMatch(
      /^https:\/\/discord\.com\/channels\/[^/]+\/[^/]+\/[1-9][0-9]*$/u
    );
  }

  return { saved, batches };
};

describe("assembled durable Harvest", () => {
  afterEach(() => vi.useRealTimers());

  it("retains fixture questions and comments through refresh failure, reconstruction and native alarm recovery", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2_000_000_000_000);

    const effect = projectHarvestStub(
      env.PROJECT_HARVEST,
      EFFECT_PROJECT,
      "fixture"
    );

    const xstate = projectHarvestStub(
      env.PROJECT_HARVEST,
      XSTATE_PROJECT,
      "fixture"
    );

    await effect.activate(EFFECT_PROJECT.id);
    await xstate.activate(XSTATE_PROJECT.id);
    const initial = await complete(effect, EFFECT_PROJECT);
    const sibling = await complete(xstate, XSTATE_PROJECT);
    expect([
      initial.batches > 1,
      initial.saved.questions.length,
      sibling.saved.questions.length,
    ]).toStrictEqual([true, 9, 2]);

    await runInDurableObject(effect, async (_instance, state) => {
      const messages = await Effect.runPromise(
        ProjectStorage.use((store) => store.messages).pipe(
          Effect.provide(ProjectStorage.layer(state.storage))
        )
      );

      expect(messages).toHaveLength(11);
      expect(
        messages.filter(
          (message) => message.channelId !== message.parentChannelId
        )
      ).toMatchObject([{ authorName: EFFECT_PROJECT.ownerName }]);
    });

    vi.setSystemTime(Date.now() + 60_000);
    const requested = await effect.requestHarvest(EFFECT_PROJECT);

    await runInDurableObject(effect, async (_instance, state) => {
      const runtime = ManagedRuntime.make(
        Layer.mergeAll(
          ProjectStorage.layer(state.storage),
          Corpus.stub,
          Judge.stub,
          Layer.succeed(
            Discord,
            Discord.of({
              messagesSince: () => Effect.die("legacy"),
              hasReplyFrom: () => Effect.die("legacy"),
              sourcePage: () =>
                Effect.fail(new DiscordFailed({ reason: "fixture outage" })),
            })
          )
        )
      );

      try {
        const scheduled = new ScheduledHarvest(runtime, "fixture");
        await scheduled.alarm(EFFECT_PROJECT);
        const failed = await scheduled.read(EFFECT_PROJECT);
        expect(failed.harvest.status).toBe("partial");
        expect(failed.harvest.lastCompleteSuccess).toBe(
          initial.saved.harvest.lastCompleteSuccess
        );
        expect(failed.questions).toStrictEqual(initial.saved.questions);
      } finally {
        await runtime.dispose();
      }
    });

    const before = await runInDurableObject(effect, (instance) => instance);
    await evictDurableObject(effect);
    await expect(
      runInDurableObject(effect, (instance) => instance)
    ).resolves.not.toBe(before);
    const recovered = await complete(effect, EFFECT_PROJECT);
    expect([requested.questions, recovered.saved.questions]).toStrictEqual([
      initial.saved.questions,
      initial.saved.questions,
    ]);
    expect(recovered.saved.harvest.lastCompleteSuccess).toBeGreaterThan(
      initial.saved.harvest.lastCompleteSuccess ?? 0
    );
    await expect(xstate.read(XSTATE_PROJECT)).resolves.toStrictEqual(
      sibling.saved
    );
  });
});
