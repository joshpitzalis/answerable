import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, textProject } from "./harvest.test-utils";
import {
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("Project collection freshness", () => {
  it("waits for every Channel's discovery even after all message pages finish", async () => {
    const project = {
      ...textProject("mixed-discovery-freshness"),
      channels: [
        { id: "800", name: "first" },
        { id: "801", name: "second" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };

    await withScheduledHarvest(
      stub,
      time,
      discordPage([]),
      async (scheduled, storage) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        await finishTextDiscovery(scheduled, project, time);
        await finishTextDiscovery(scheduled, project, time);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        expect([
          await scheduled.runtime.runPromise(store.progress("800")),
          await scheduled.runtime.runPromise(store.progress("801")),
        ]).toMatchObject([
          { streamId: "800", seeded: true, generation: 1, before: null },
          { streamId: "801", seeded: true, generation: 1, before: null },
        ]);
        expect(
          storage.sql
            .exec<{ channel_id: string; archive_done: number }>(
              "SELECT channel_id,archive_done FROM forum_scans ORDER BY channel_id"
            )
            .toArray()
        ).toStrictEqual([
          { channel_id: "800", archive_done: 1 },
          { channel_id: "801", archive_done: 0 },
        ]);
        await expect(scheduled.read(project)).resolves.toMatchObject({
          harvest: { status: "waiting", nextEligibleAt: time.now + 1000 },
        });
        time.now += 1000;
        await expect(scheduled.read(project)).resolves.toMatchObject({
          harvest: { status: "working", pendingProcessing: 0 },
        });
        await scheduled.alarm(project);
        await expect(scheduled.read(project)).resolves.toMatchObject({
          harvest: { status: "current", pendingProcessing: 0 },
        });
      }
    );
  });
});
