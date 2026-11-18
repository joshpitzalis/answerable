import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { ScheduledHarvest } from "../../features/question-finder/workflows/scheduledHarvest";
import { projectHarvestStub } from "../projectHarvest";
import { sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("suspended Harvest recovery", () => {
  it("does not let a running batch commit or rearm after suspension", async () => {
    const project = textProject("suspend-held-batch");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const started = Deferred.makeUnsafe<undefined>();
    const release = Deferred.makeUnsafe<undefined>();

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("legacy"),
        sourcePage: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);

            return [sourceMessage("101")];
          }),
      })
    );

    await withScheduledHarvest(
      stub,
      { now: 2_000_000_000_000 },
      wire,
      async (scheduled, storage) => {
        await scheduled.activate(project);
        const running = scheduled.alarm(project);
        await Effect.runPromise(Deferred.await(started));

        const stopped = new ScheduledHarvest(
          scheduled.runtime,
          "live",
          undefined,
          false
        );

        await stopped.read(project);
        await Effect.runPromise(Deferred.succeed(release, undefined));
        await running;
        const saved = await stopped.read(project);
        expect(saved.harvest).toMatchObject({
          status: "suspended",
          nextEligibleAt: null,
          lastCompleteSuccess: null,
        });
        expect(saved.questions).toStrictEqual([]);
        await expect(storage.getAlarm()).resolves.toBeNull();
        expect(
          storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM messages")
            .one().count
        ).toBe(0);
      }
    );
  });

  it("re-added Channels continue a saved page range", async () => {
    const project = textProject("readd-range");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const requested: (string | null)[] = [];

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("legacy"),
        sourcePage: (request) => {
          requested.push(request.before);

          return Effect.succeed([sourceMessage("150")]);
        },
      })
    );

    const time = { now: 2_000_000_000_000 };
    await withScheduledHarvest(stub, time, wire, async (scheduled, storage) => {
      await scheduled.activate(project);
      await scheduled.runtime.runPromise(
        ProjectStorage.use((store) =>
          store.ingestPage({
            messages: [],
            progress: {
              streamId: "800",
              parentChannelId: "800",
              completedBoundary: "100",
              upperBoundary: "200",
              before: "151",
              seeded: true,
              lastCompletedAt: time.now,
              failure: null,
            },
            policyRevision: "test",
            observedAt: time.now,
          })
        )
      );
      await scheduled.read({ ...project, channels: [] });
      await scheduled.activate(project);
      await scheduled.alarm(project);
      expect(requested).toStrictEqual(["151"]);
      expect(
        storage.sql
          .exec<{ completed_boundary: string }>(
            "SELECT completed_boundary FROM fetch_progress WHERE stream_id='800'"
          )
          .one().completed_boundary
      ).toBe("200");
    });
  });
});
