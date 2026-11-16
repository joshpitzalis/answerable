import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import {
  Judge,
  JudgeFailed,
} from "../../features/question-finder/services/judge";
import { ProjectStorageError } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import {
  emptyDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("retry completion transaction", () => {
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
