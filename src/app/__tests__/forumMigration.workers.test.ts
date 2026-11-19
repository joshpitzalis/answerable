import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  migrateProjectStorage,
  projectMigrations,
  ProjectStorage,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { textProject, unavailableDiscord } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";
import { reply } from "./threadWriter.test-utils";

describe("forum failure upgrades", () => {
  it.each(["active", "starter"])(
    "clears a legacy failure when %s acquisition succeeds",
    async (stage) => {
      const project = textProject(`legacy-forum-failure-${stage}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      const at = Date.parse("2026-11-01T00:00:02Z");
      await withScheduledHarvest(
        stub,
        { now: at },
        unavailableDiscord,
        async (scheduled, storage) => {
          await storage.deleteAll();
          migrateProjectStorage(storage, projectMigrations.slice(0, 5));
          storage.sql.exec(
            "UPDATE harvest_state SET project_id=?,server_id=?,activated_at=? WHERE id=1",
            project.id,
            project.serverId,
            at - 2000
          );
          storage.sql.exec(
            "UPDATE harvest_cycle SET generation=1,active=1 WHERE id=1"
          );
          // Schema five's acquisition writer stored failures before retry records existed.
          storage.sql.exec(
            "INSERT INTO fetch_progress(stream_id,parent_channel_id,failure) VALUES ('800','800','Discord could not be read')"
          );

          if (stage === "starter") {
            storage.sql.exec(
              "INSERT INTO discord_threads(id,parent_channel_id,title,starter_id,archived,archive_timestamp,observed_at) VALUES ('101','800','Question','101',0,'2026-11-01T00:00:00Z',?)",
              at - 1000
            );
            storage.sql.exec(
              "INSERT INTO forum_scans VALUES ('800',1,1,1,NULL,'2026-11-01T00:00:00Z','2026-11-01T00:00:01Z')"
            );
          }

          migrateProjectStorage(storage);
          await expect(scheduled.read(project)).resolves.toMatchObject({
            harvest: { status: "partial" },
            failedChannels: [
              { name: "help", reason: "Discord could not be read" },
            ],
          });
          const store = await scheduled.runtime.runPromise(ProjectStorage);
          await scheduled.runtime.runPromise(
            stage === "active"
              ? store.saveThreadPage(
                  "800",
                  1,
                  {
                    scope: "active",
                    threads: [],
                    hasMore: false,
                    isForum: true,
                  },
                  at
                )
              : store.saveForumStarter(
                  "800",
                  1,
                  { ...reply("101"), isPost: true },
                  "test",
                  at
                )
          );
          await expect(scheduled.read(project)).resolves.toMatchObject({
            harvest: { status: "working" },
            failedChannels: [],
          });
        }
      );
    }
  );
});
