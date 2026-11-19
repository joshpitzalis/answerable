import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("processing claim fairness", () => {
  it("does not acquire activated sources until a cycle begins", async () => {
    const project = textProject("inactive-acquisition");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    await withHarvestRuntime(
      stub,
      discordPage([]),
      Judge.everythingAnswerable,
      (runtime) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            yield* store.reconcileConfiguration(project, "live", true, 1000);
            yield* store.activate(project, 1000);

            expect(yield* store.claimAcquisition(project)).toBeNull();
            yield* store.beginCycle;
            expect(yield* store.claimAcquisition(project)).toMatchObject({
              channelId: "800",
              generation: 1,
            });
          })
        )
    );
  });

  it("has no acquisition or processing claim after every Channel is removed", async () => {
    const original = textProject("no-configured-channels");
    const project = { ...original, channels: [] };
    const stub = projectHarvestStub(env.PROJECT_HARVEST, original, "live");

    await withHarvestRuntime(
      stub,
      discordPage([]),
      Judge.everythingAnswerable,
      (runtime) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            yield* store.reconcileConfiguration(original, "live", true, 1000);
            yield* store.activate(original, 1000);
            yield* store.beginCycle;
            yield* store.reconcileConfiguration(project, "live", true, 2000);
            expect(yield* store.claimAcquisition(project)).toBeNull();
            expect(yield* store.claimProcessing(project)).toBeNull();
          })
        )
    );
  });

  it("skips empty and deferred Channels to reach eligible saved work", async () => {
    const project = {
      ...textProject("three-processing-turns"),
      channels: [
        { id: "800", name: "empty" },
        { id: "801", name: "deferred" },
        { id: "802", name: "ready" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    await withHarvestRuntime(
      stub,
      discordPage([]),
      Judge.everythingAnswerable,
      (runtime) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            yield* store.reconcileConfiguration(project, "live", true, 1000);
            yield* store.activate(project, 1000);
            yield* store.beginCycle;

            for (const [channelId, messageId] of [
              ["801", "201"],
              ["802", "202"],
            ]) {
              const progress = yield* store.progress(channelId);
              yield* store.ingestPage({
                progress,
                messages: [
                  {
                    ...sourceMessage(messageId),
                    channelId,
                    parentChannelId: channelId,
                  },
                ],
                observedAt: 1000,
                policyRevision: "test",
              });
            }

            yield* store.retry({
              kind: "processing",
              workId: "201",
              channelId: "801",
              reason: "Judge deferred",
              retryAfterMs: 60_000,
            });
            expect(yield* store.claimProcessing(project)).toBe("802");
            yield* store.retry({
              kind: "processing",
              workId: "202",
              channelId: "802",
              reason: "Judge deferred",
              retryAfterMs: 60_000,
            });
            expect(yield* store.claimProcessing(project)).toBeNull();
          })
        )
    );
  });
});
