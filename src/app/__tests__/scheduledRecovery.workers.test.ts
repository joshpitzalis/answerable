import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { ProjectStorageError } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("scheduled crash recovery", () => {
  it.each([
    [
      "before activation commits",
      "BEFORE UPDATE OF project_id ON harvest_schedule",
      0,
    ],
    [
      "after activation commits",
      "BEFORE UPDATE OF next_alarm ON harvest_schedule WHEN NEW.next_due IS NOT NULL",
      1,
    ],
  ])("keeps a recovery wake %s", async (_label, trigger, expectedActivated) => {
    const project = textProject(`activation-crash-${expectedActivated}`);
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    await withScheduledHarvest(
      stub,
      time,
      discordPage([]),
      async (scheduled, storage) => {
        storage.sql.exec(
          `CREATE TRIGGER activation_crash ${trigger} BEGIN SELECT RAISE(ABORT, 'crash'); END`
        );
        await expect(scheduled.activate(project)).rejects.toBeInstanceOf(
          ProjectStorageError
        );
        const saved = await scheduled.read(project);
        expect(Number(saved.harvest.activatedAt !== null)).toBe(
          expectedActivated
        );
        await expect(storage.getAlarm()).resolves.not.toBeNull();
        storage.sql.exec("DROP TRIGGER activation_crash");
      }
    );
    await evictDurableObject(stub);
    await withScheduledHarvest(
      stub,
      time,
      discordPage([]),
      async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        const saved = await scheduled.read(project);
        expect(saved.harvest.status).toBe("current");
      }
    );
  });

  it.each([
    ["claim", "BEFORE UPDATE OF acquire_turn ON harvest_cycle", 0],
    ["processing", "BEFORE INSERT ON questions", 1],
  ])(
    "recovers interrupted %s work after reconstruction",
    async (label, trigger, retained) => {
      const project = textProject(`work-crash-${label}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      const time = { now: 2_000_000_000_000 };
      const wire = discordPage([sourceMessage("101")]);
      await withScheduledHarvest(
        stub,
        time,
        wire,
        async (scheduled, storage) => {
          await scheduled.activate(project);
          storage.sql.exec(
            `CREATE TRIGGER work_crash ${trigger} BEGIN SELECT RAISE(ABORT, 'crash'); END`
          );
          await expect(scheduled.alarm(project)).rejects.toBeInstanceOf(
            ProjectStorageError
          );
          expect(
            storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM messages")
              .one().count
          ).toBe(retained);
          await expect(storage.getAlarm()).resolves.toBe(time.now + 30_000);
          storage.sql.exec("DROP TRIGGER work_crash");
        }
      );
      await evictDurableObject(stub);
      time.now += 30_000;
      await withScheduledHarvest(stub, time, wire, async (scheduled) => {
        await scheduled.alarm(project);
        const saved = await scheduled.read(project);
        expect([saved.questions.length, saved.harvest.status]).toStrictEqual([
          1,
          "current",
        ]);
      });
    }
  );

  it("reschedules a committed cycle after a crash without collecting it twice", async () => {
    const project = textProject("completed-cycle-crash");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    let calls = 0;

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("legacy"),
        sourcePage: () =>
          Effect.sync(() => {
            calls += 1;

            return [sourceMessage("101")];
          }),
      })
    );

    await withScheduledHarvest(stub, time, wire, async (scheduled, storage) => {
      await scheduled.activate(project);
      storage.sql
        .exec(`CREATE TRIGGER crash_final_schedule BEFORE UPDATE OF next_due ON harvest_schedule
        WHEN (SELECT active FROM harvest_cycle WHERE id=1)=0
        BEGIN SELECT RAISE(ABORT, 'crash after commit'); END`);
      await expect(scheduled.alarm(project)).rejects.toBeInstanceOf(
        ProjectStorageError
      );
      await expect(storage.getAlarm()).resolves.toBe(time.now + 30_000);
      storage.sql.exec("DROP TRIGGER crash_final_schedule");
    });
    await evictDurableObject(stub);
    time.now += 30_000;
    await withScheduledHarvest(stub, time, wire, async (scheduled) => {
      await scheduled.alarm(project);
      const saved = await scheduled.read(project);
      expect(calls).toBe(1);
      expect(saved.harvest.nextEligibleAt).toBe(time.now - 30_000 + 900_000);
    });
  });
});
