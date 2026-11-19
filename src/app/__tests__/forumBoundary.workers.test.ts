import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { textProject, unavailableDiscord } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";
import { thread } from "./threadWriter.test-utils";

describe("forum activation coverage", () => {
  it("retains both archive timestamp boundaries without admitting adjacent history", async () => {
    const project = textProject("exact-archive-range");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: Date.parse("2026-11-01T00:00:00Z") };

    await withScheduledHarvest(
      stub,
      time,
      unavailableDiscord,
      async (scheduled, storage) => {
        await scheduled.activate(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        time.now += 10_000;
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            { scope: "active", threads: [], hasMore: false, isForum: true },
            time.now
          )
        );
        time.now += 10_000;
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            {
              scope: "archive",
              isForum: true,
              hasMore: false,
              threads: [
                ["101", "2026-10-31T23:59:59.999999Z"],
                ["102", "2026-11-01T00:00:00.000000Z"],
                ["103", "2026-11-01T00:00:10.000000Z"],
                ["104", "2026-11-01T00:00:10.000001Z"],
              ].map(([id, archiveTimestamp]) => ({
                ...thread,
                id,
                starterId: id,
                archived: true,
                archiveTimestamp,
              })),
            },
            time.now
          )
        );
        expect(
          storage.sql
            .exec<{ id: string }>("SELECT id FROM discord_threads ORDER BY id")
            .toArray()
            .map((saved) => saved.id)
        ).toStrictEqual(["102", "103"]);
      }
    );
  });

  it("includes a post exactly at activation after the initial active scan", async () => {
    const project = textProject("exact-forum-activation");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 1_420_070_400_001 };

    await withScheduledHarvest(
      stub,
      time,
      unavailableDiscord,
      async (scheduled, storage) => {
        await scheduled.activate(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            { scope: "active", threads: [], hasMore: false, isForum: true },
            time.now
          )
        );
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            {
              scope: "active",
              isForum: true,
              hasMore: false,
              threads: ["4194303", "4194304", "4194305"].map((id) => ({
                ...thread,
                id,
                starterId: id,
                archiveTimestamp: "2015-01-01T00:00:00.001Z",
              })),
            },
            time.now
          )
        );
        expect(
          storage.sql
            .exec<{ id: string }>("SELECT id FROM discord_threads ORDER BY id")
            .toArray()
            .map((saved) => saved.id)
        ).toStrictEqual(["4194304", "4194305"]);
      }
    );
  });
});
