import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, textProject } from "./harvest.test-utils";
import {
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("configured source changes", () => {
  it("ignores a removed Channel's unfinished coverage without deleting its progress", async () => {
    const remaining = textProject("removed-unfinished-channel");

    const original = {
      ...remaining,
      channels: [...remaining.channels, { id: "801", name: "removed" }],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, original, "live");
    const time = { now: 2_000_000_000_000 };

    await withScheduledHarvest(
      stub,
      time,
      discordPage([]),
      async (scheduled) => {
        await scheduled.activate(original);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const unfinished = await scheduled.runtime.runPromise(
          store.progress("801")
        );

        expect(unfinished).toMatchObject({
          seeded: false,
          completedBoundary: null,
        });
        await scheduled.read(remaining);
        await scheduled.alarm(remaining);
        await finishTextDiscovery(scheduled, remaining, time);
        await expect(scheduled.read(remaining)).resolves.toMatchObject({
          questions: [],
          failedChannels: [],
          harvest: { status: "current", pendingProcessing: 0 },
        });
        await expect(
          scheduled.runtime.runPromise(store.progress("801"))
        ).resolves.toStrictEqual(unfinished);
      }
    );
  });

  it("creates progress for a newly configured Channel when the next batch starts", async () => {
    const original = textProject("added-channel-progress");

    const project = {
      ...original,
      channels: [...original.channels, { id: "801", name: "new" }],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, original, "live");
    const time = { now: 2_000_000_000_000 };
    await withScheduledHarvest(
      stub,
      time,
      discordPage([]),
      async (scheduled, storage) => {
        await scheduled.activate(original);
        await scheduled.alarm(original);
        await finishTextDiscovery(scheduled, original, time);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const previous = await scheduled.runtime.runPromise(
          store.progress("800")
        );

        time.now += 5000;
        await scheduled.runtime.runPromise(
          store.reconcileConfiguration(project, "live", true, time.now)
        );
        await expect(storage.getAlarm()).resolves.toBe(time.now);
        await scheduled.runtime.runPromise(
          store.startScheduled(project, time.now)
        );
        await expect(
          scheduled.runtime.runPromise(store.progress("801"))
        ).resolves.toMatchObject({
          streamId: "801",
          parentChannelId: "801",
          seeded: false,
          completedBoundary: null,
        });
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toStrictEqual(previous);
        const saved = await scheduled.read(project);
        expect(saved.harvest.lastAttempt).toBe(time.now);
      }
    );
  });
});
