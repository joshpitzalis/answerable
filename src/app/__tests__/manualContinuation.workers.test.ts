import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import {
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("manual requests during continuation", () => {
  it("joins an active cycle without consuming a new manual cooldown", async () => {
    const project = textProject("manual-during-continuation");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    await withScheduledHarvest(
      stub,
      time,
      discordPage([sourceMessage("101")]),
      async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        const before = await scheduled.runtime.runPromise(store.schedule);
        expect(before).toMatchObject({
          nextDue: 2_000_000_001_000,
          lastManual: 2_000_000_000_000,
        });

        time.now += 100;
        await scheduled.request(project);
        await expect(
          scheduled.runtime.runPromise(store.schedule)
        ).resolves.toStrictEqual(before);
        await finishTextDiscovery(scheduled, project, time);
        await expect(scheduled.read(project)).resolves.toMatchObject({
          harvest: { status: "current", pendingProcessing: 0 },
        });
      }
    );
  });
});
