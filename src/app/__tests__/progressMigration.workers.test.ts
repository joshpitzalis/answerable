import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  migrateProjectStorage,
  projectMigrations,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { textProject, unavailableDiscord } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("pre-cycle progress upgrades", () => {
  it.each(["unseeded", "continuation", "missing", "complete"])(
    "preserves %s source freshness after upgrading schema three",
    async (kind) => {
      const project = {
        ...textProject(`old-progress-${kind}`),
        channels: [
          { id: "800", name: "finished" },
          { id: "801", name: "pending" },
        ],
      };

      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      await withScheduledHarvest(
        stub,
        { now: 2000 },
        unavailableDiscord,
        async (scheduled, storage) => {
          await storage.deleteAll();
          migrateProjectStorage(storage, projectMigrations.slice(0, 3));
          storage.sql.exec(
            "UPDATE harvest_state SET project_id=?,server_id=?,activated_at=1000 WHERE id=1",
            project.id,
            project.serverId
          );
          storage.sql.exec(
            "INSERT INTO fetch_progress(stream_id,parent_channel_id,seeded,completed_boundary,last_completed_at) VALUES ('800','800',1,'100',1000)"
          );

          if (kind === "unseeded") {
            storage.sql.exec(
              "INSERT INTO fetch_progress(stream_id,parent_channel_id) VALUES ('801','801')"
            );
          } else if (kind === "continuation") {
            storage.sql.exec(
              "INSERT INTO fetch_progress(stream_id,parent_channel_id,seeded,completed_boundary,upper_boundary,before_id,last_completed_at) VALUES ('801','801',1,'100','200','151',1000)"
            );
          } else if (kind === "complete") {
            storage.sql.exec(
              "INSERT INTO fetch_progress(stream_id,parent_channel_id,seeded,completed_boundary,last_completed_at) VALUES ('801','801',1,'100',1000)"
            );
            storage.sql.exec(
              "UPDATE harvest_state SET last_complete_success=1000 WHERE id=1"
            );
          }

          migrateProjectStorage(storage);
          const saved = await scheduled.read(project);
          expect(
            storage.sql.exec("SELECT active FROM harvest_cycle").one()
          ).toMatchObject({ active: 0 });
          expect(saved.harvest).toMatchObject({
            status: kind === "complete" ? "current" : "working",
            pendingProcessing: 0,
            lastCompleteSuccess: kind === "complete" ? 1000 : null,
          });
        }
      );
    }
  );
});
