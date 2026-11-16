import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { projectHarvestStub } from "../projectHarvest";
import { discordPage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("manual Harvest cooldown", () => {
  it("counts a queued manual run toward the next cooldown and coalesces repeated clicks", async () => {
    const project = textProject("manual-cooldown");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    const initial = time.now;
    await withScheduledHarvest(
      stub,
      time,
      discordPage([]),
      async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        time.now += 30_000;
        await scheduled.request(project);
        time.now += 10_000;
        await scheduled.request(project);
        const waiting = await scheduled.read(project);
        expect(waiting.harvest.nextEligibleAt).toBe(initial + 60_000);
        time.now = initial + 60_000;
        await scheduled.alarm(project);
        time.now += 10_000;
        await scheduled.request(project);
        const next = await scheduled.read(project);
        expect(next.harvest.nextEligibleAt).toBe(initial + 120_000);
      }
    );
  });
});
