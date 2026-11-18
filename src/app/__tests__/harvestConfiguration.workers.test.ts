import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorageError } from "../../features/question-finder/services/projectStorage";
import { ScheduledHarvest } from "../../features/question-finder/workflows/scheduledHarvest";
import { projectHarvestStub } from "../projectHarvest";
import { sourceMessage, textProject } from "./harvest.test-utils";
import {
  emptyDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

const wire = Layer.succeed(
  Discord,
  Discord.of({
    messagesSince: () => Effect.die("legacy"),
    hasReplyFrom: () => Effect.die("legacy"),
    sourcePage: (request) =>
      Effect.succeed(emptyDiscovery(request) ?? [sourceMessage("101")]),
  })
);

describe("trusted Harvest configuration", () => {
  it("keeps saved identity on rename, hides removed Channels and resumes retained progress", async () => {
    const project = textProject("configuration-retention");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withScheduledHarvest(
      stub,
      { now: 2_000_000_000_000 },
      wire,
      async (scheduled, storage) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);

        const renamed = {
          ...project,
          slug: "renamed",
          label: "Renamed",
          channels: [{ id: "800", name: "Renamed channel" }],
        };

        const saved = await scheduled.read(renamed);
        expect(saved.questions[0]).toMatchObject({
          project: "renamed",
          channel: { name: "Renamed channel" },
        });
        storage.sql.exec(
          "INSERT INTO reconciliation_work(work_id,channel_id,stream_id,kind) VALUES ('removed-recheck','800','800','text')"
        );
        const removed = await scheduled.read({ ...renamed, channels: [] });
        expect(removed).toMatchObject({
          questions: [],
          contributorStats: null,
        });
        expect(
          storage.sql
            .exec<{ retained: number; work: number }>(
              "SELECT (SELECT COUNT(*) FROM messages) AS retained, (SELECT COUNT(*) FROM reconciliation_work) AS work"
            )
            .one()
        ).toStrictEqual({ retained: 1, work: 0 });
        const restored = await scheduled.activate(renamed);
        expect(restored.questions).toHaveLength(1);
        expect(
          storage.sql
            .exec<{ seeded: number }>(
              "SELECT seeded FROM fetch_progress WHERE stream_id='800'"
            )
            .one().seeded
        ).toBe(1);
      }
    );
  });

  it.each(["acquisition", "processing"])(
    "fences a removed Channel while %s is pending",
    async (phase) => {
      const project = textProject(`configuration-held-${phase}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      const started = Deferred.makeUnsafe<undefined>();
      const release = Deferred.makeUnsafe<undefined>();

      const hold = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
      });

      let calls = 0;

      const held = Layer.succeed(
        Discord,
        Discord.of({
          messagesSince: () => Effect.die("legacy"),
          hasReplyFrom: () => Effect.die("legacy"),
          sourcePage: () =>
            Effect.gen(function* () {
              calls += 1;

              if (phase === "acquisition") {
                yield* hold;
              }

              return [sourceMessage("101")];
            }),
        })
      );

      const judge = Layer.succeed(
        Judge,
        Judge.of({
          answerable: () =>
            Effect.gen(function* () {
              if (phase === "processing") {
                yield* hold;
              }

              return { answerable: true, reason: "test" };
            }),
        })
      );

      await withScheduledHarvest(
        stub,
        { now: 2_000_000_000_000 },
        held,
        async (scheduled, storage) => {
          await scheduled.activate(project);
          const running = scheduled.alarm(project);
          await Effect.runPromise(Deferred.await(started));
          const removed = { ...project, channels: [] };
          await scheduled.read(removed);
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await running;
          const saved = await scheduled.read(removed);
          expect(saved.questions).toStrictEqual([]);
          expect(
            storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM messages")
              .one().count
          ).toBe(phase === "acquisition" ? 0 : 1);
          expect(
            storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM questions"
              )
              .one().count
          ).toBe(0);
          expect(calls).toBe(1);
        },
        judge
      );
    }
  );

  it.each(["removed", "mode", "disabled"])(
    "quiesces %s Projects and resumes saved state",
    async (reason) => {
      const project = textProject(`configuration-${reason}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      await withScheduledHarvest(
        stub,
        { now: 2_000_000_000_000 },
        wire,
        async (scheduled, storage) => {
          await scheduled.activate(project);
          await scheduled.alarm(project);

          const stopped = new ScheduledHarvest(
            scheduled.runtime,
            reason === "mode" ? "fixture" : "live",
            undefined,
            reason !== "disabled"
          );

          await stopped.alarm(reason === "removed" ? undefined : project);
          await expect(storage.getAlarm()).resolves.toBeNull();
          expect(
            storage.sql
              .exec<{ next_due: number | null }>(
                "SELECT next_due FROM harvest_schedule"
              )
              .one().next_due
          ).toBeNull();

          const restored = await scheduled.activate(project);
          expect(restored.questions).toHaveLength(1);
          await expect(storage.getAlarm()).resolves.not.toBeNull();
        }
      );
    }
  );

  it("does not activate on reads or allow a Project ID to move to another server", async () => {
    const project = textProject("configuration-identity");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withScheduledHarvest(
      stub,
      { now: 2_000_000_000_000 },
      wire,
      async (scheduled, storage) => {
        const initial = await scheduled.read(project);
        expect(initial.harvest.activatedAt).toBeNull();
        await expect(storage.getAlarm()).resolves.toBeNull();
        await scheduled.activate(project);
        await expect(
          scheduled.activate({ ...project, serverId: "other-server" })
        ).rejects.toThrow(ProjectStorageError);
        await expect(storage.getAlarm()).resolves.toBeNull();
      }
    );
  });

  it("keeps disabled refreshes suspended without deleting saved questions", async () => {
    const project = textProject("configuration-disabled-refresh");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withScheduledHarvest(
      stub,
      { now: 2_000_000_000_000 },
      wire,
      async (scheduled, storage) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);

        const stopped = new ScheduledHarvest(
          scheduled.runtime,
          "live",
          undefined,
          false
        );

        const saved = await stopped.request(project);
        expect(saved.harvest.status).toBe("suspended");
        expect(saved.questions).toHaveLength(1);
        await expect(storage.getAlarm()).resolves.toBeNull();
      }
    );
  });
});
