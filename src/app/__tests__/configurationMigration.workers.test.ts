import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  migrateProjectStorage,
  projectMigrations,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { textProject, unavailableDiscord } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("configuration migration", () => {
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
