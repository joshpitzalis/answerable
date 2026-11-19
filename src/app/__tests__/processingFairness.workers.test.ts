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
