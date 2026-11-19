import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { activationBoundary } from "../../features/question-finder/domain/values/harvest.values";
import {
  migrateProjectStorage,
  projectMigrations,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { textProject, unavailableDiscord } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("configuration migration", () => {
  it.each([false, true])(
    "retains restored source freshness before the next cycle, failed=%s",
    async (failed) => {
      const project = textProject(`restored-source-after-upgrade-${failed}`);
      const at = 2_000_000_000_000;
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      await withScheduledHarvest(
        stub,
        { now: at },
        unavailableDiscord,
        async (scheduled, storage) => {
          await storage.deleteAll();
          migrateProjectStorage(storage, projectMigrations.slice(0, 8));
          storage.sql.exec(
            "UPDATE harvest_state SET project_id=?,server_id=?,activated_at=?,last_complete_success=?,last_attempt=? WHERE id=1",
            project.id,
            project.serverId,
            at - 1_800_000,
            at - 1000,
            at - 5000
          );
          storage.sql.exec(
            "UPDATE harvest_schedule SET project_id=?,mode='live',next_due=?,last_manual=? WHERE id=1",
            project.id,
            at + 899_000,
            at - 5000
          );
          storage.sql.exec(
            "UPDATE harvest_cycle SET generation=2,active=0 WHERE id=1"
          );
          // Before source configuration was stored, removed sources retained their last completed generation.
          storage.sql.exec(
            "INSERT INTO fetch_progress(stream_id,parent_channel_id,completed_boundary,seeded,generation,is_forum,last_completed_at,failure) VALUES ('800','800',?,1,1,0,?,?),('801','801',?,1,2,0,?,NULL)",
            activationBoundary(at - 1_002_000),
            at - 1_000_000,
            failed ? "Saved acquisition failure" : null,
            activationBoundary(at - 3000),
            at - 1000
          );
          storage.sql.exec(
            "INSERT INTO forum_scans VALUES ('800',1,1,1,NULL,?,?),('801',2,1,1,NULL,?,?)",
            new Date(at - 1_001_000).toISOString(),
            new Date(at - 1_001_000).toISOString(),
            new Date(at - 2000).toISOString(),
            new Date(at - 2000).toISOString()
          );
          migrateProjectStorage(storage);
          await expect(scheduled.read(project)).resolves.toMatchObject({
            harvest: {
              status: failed ? "partial" : "current",
              pendingProcessing: 0,
            },
            failedChannels: failed
              ? [{ name: "help", reason: "Saved acquisition failure" }]
              : [],
          });
          await expect(scheduled.request(project)).resolves.toMatchObject({
            harvest: {
              status: failed ? "partial" : "waiting",
              nextEligibleAt: at + 55_000,
            },
          });
          expect(
            storage.sql
              .exec("SELECT generation,active FROM harvest_cycle")
              .one()
          ).toStrictEqual({ generation: 2, active: 0 });
        }
      );
    }
  );

  it.each([true, false])(
    "retains old work and respects the stored wake when the upgraded Project is absent=%s",
    async (absent) => {
      const project = textProject(`configuration-upgrade-retention-${absent}`);
      const due = 2_000_000_060_000;
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      await withScheduledHarvest(
        stub,
        { now: 2_000_000_000_000 },
        unavailableDiscord,
        async (scheduled, storage) => {
          await storage.deleteAll();
          migrateProjectStorage(storage, projectMigrations.slice(0, 8));
          storage.sql.exec(
            "UPDATE harvest_state SET project_id=?,server_id=?,activated_at=1 WHERE id=1",
            project.id,
            project.serverId
          );
          storage.sql.exec(
            "UPDATE harvest_schedule SET project_id=?,mode='live',next_due=? WHERE id=1",
            project.id,
            due
          );
          storage.sql.exec(
            "UPDATE harvest_cycle SET generation=1,active=1 WHERE id=1"
          );
          storage.sql.exec(
            "INSERT INTO fetch_progress(stream_id,parent_channel_id,completed_boundary,seeded,generation,is_forum) VALUES ('800','800','100',1,1,0)"
          );
          storage.sql.exec(
            "INSERT INTO harvest_retries VALUES ('acquisition','800','800',1,2,3000,0,'Saved retry')"
          );
          storage.sql.exec(
            "INSERT INTO reconciliation_work(work_id,channel_id,stream_id,kind) VALUES ('reconcile:recent:800','800','800','recent')"
          );
          migrateProjectStorage(storage);
          await scheduled.alarm(absent ? undefined : project);
          expect(
            storage.sql
              .exec("SELECT work_id,attempts,next_due FROM harvest_retries")
              .toArray()
          ).toStrictEqual([{ work_id: "800", attempts: 2, next_due: 3000 }]);
          expect(
            storage.sql
              .exec("SELECT work_id FROM reconciliation_work")
              .toArray()
          ).toStrictEqual([{ work_id: "reconcile:recent:800" }]);
          expect(
            storage.sql
              .exec("SELECT next_due,next_alarm FROM harvest_schedule")
              .one()
          ).toStrictEqual({
            next_due: absent ? null : due,
            next_alarm: absent ? null : due,
          });
          await expect(storage.getAlarm()).resolves.toBe(absent ? null : due);
        }
      );
    }
  );
});
