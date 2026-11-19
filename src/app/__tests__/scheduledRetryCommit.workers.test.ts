import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import {
  Judge,
  JudgeFailed,
} from "../../features/question-finder/services/judge";
import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  withHarvestRuntime,
} from "./harvest.test-utils";
import {
  emptyDiscovery,
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("retry completion transaction", () => {
  it("keeps a sibling processing failure visible until the last retry succeeds", async () => {
    const project = textProject("retry-sibling-cleanup");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };

    await withScheduledHarvest(
      stub,
      time,
      discordPage([sourceMessage("101"), sourceMessage("102")]),
      async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        await finishTextDiscovery(scheduled, project, time);
        const saved = await scheduled.read(project);
        expect(saved.harvest.status).toBe("current");
      }
    );

    await withHarvestRuntime(
      stub,
      discordPage([]),
      Judge.everythingAnswerable,
      (runtime) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            yield* store.reprocess(["800"], "retry-policy");
            const [first, second] = yield* store.pending(["800"], 20);

            if (first === undefined || second === undefined) {
              throw new Error("Both saved messages must be pending");
            }

            for (const candidate of [first, second]) {
              yield* store.retry({
                kind: "processing",
                workId: candidate.message.id,
                channelId: "800",
                generation: candidate.generation,
                reason: "Judge offline",
              });
            }

            yield* store.complete(first, null);
            const partial = yield* store.read(project);
            expect({
              failures: partial.failedChannels,
              pending: partial.harvest.pendingProcessing,
              status: partial.harvest.status,
            }).toStrictEqual({
              failures: [{ name: "help", reason: "Judge offline" }],
              pending: 1,
              status: "partial",
            });

            yield* store.complete(second, null);
            const complete = yield* store.read(project);
            expect({
              failures: complete.failedChannels,
              pending: complete.harvest.pendingProcessing,
              status: complete.harvest.status,
            }).toStrictEqual({ failures: [], pending: 0, status: "current" });
          })
        )
    );
  });

  it("commits the result and clears its failure together, or retains both as pending", async () => {
    const project = textProject("retry-commit");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };

    const judge = Layer.succeed(
      Judge,
      Judge.of({
        answerable: () => Effect.fail(new JudgeFailed({ reason: "offline" })),
      })
    );

    await withScheduledHarvest(
      stub,
      time,
      discordPage([sourceMessage("101")]),
      async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
      },
      judge
    );
    time.now += 1000;
    await withScheduledHarvest(
      stub,
      time,
      Layer.succeed(
        Discord,
        Discord.of({
          messagesSince: () => Effect.die("legacy"),
          hasReplyFrom: () => Effect.die("legacy"),
          sourcePage: (request) => {
            const discovery = emptyDiscovery(request);

            return discovery === undefined
              ? Effect.die("Committed content must not be downloaded again")
              : Effect.succeed(discovery);
          },
        })
      ),
      async (scheduled, storage) => {
        storage.sql.exec(
          "CREATE TRIGGER retry_crash BEFORE DELETE ON harvest_retries BEGIN SELECT RAISE(ABORT, 'retry cleanup failed'); END"
        );
        await expect(scheduled.alarm(project)).rejects.toBeInstanceOf(
          ProjectStorageError
        );
        const failed = await scheduled.read(project);
        expect([
          failed.questions.length,
          failed.harvest.pendingProcessing,
          failed.failedChannels.length,
        ]).toStrictEqual([0, 1, 1]);
        storage.sql.exec("DROP TRIGGER retry_crash");
        await scheduled.alarm(project);
        const saved = await scheduled.read(project);
        expect([
          saved.questions.length,
          saved.harvest.pendingProcessing,
          saved.failedChannels.length,
          saved.harvest.status,
        ]).toStrictEqual([1, 0, 0, "current"]);
      }
    );
  });
});
