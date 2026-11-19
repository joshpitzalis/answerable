import { env } from "cloudflare:workers";
import { Deferred, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { textProject, unavailableDiscord } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("suspension across native alarm writes", () => {
  it("never arms a paused Project, including a setAlarm completion after suspension", async () => {
    const project = textProject("wake-suspension");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const at = 2_000_000_000_000;
    await withScheduledHarvest(
      stub,
      { now: at },
      unavailableDiscord,
      async (scheduled, storage) => {
        await scheduled.activate(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await scheduled.runtime.runPromise(
          store.reconcileConfiguration(project, "live", false, at)
        );
        await scheduled.runtime.runPromise(store.requestWake(at + 1000));
        await expect(storage.getAlarm()).resolves.toBeNull();
        await expect(
          scheduled.runtime.runPromise(store.schedule)
        ).resolves.toMatchObject({ nextAlarm: null });
        await scheduled.runtime.runPromise(
          store.reconcileConfiguration(project, "live", true, at)
        );

        const started = Deferred.makeUnsafe<undefined>();
        const release = Deferred.makeUnsafe<undefined>();
        const original = storage.setAlarm.bind(storage);
        storage.setAlarm = async (...args) => {
          await Effect.runPromise(Deferred.succeed(started, undefined));
          await Effect.runPromise(Deferred.await(release));
          await original(...args);
        };

        try {
          const writing = scheduled.runtime.runPromise(
            store.requestWake(at + 2000)
          );

          await Effect.runPromise(Deferred.await(started));
          await scheduled.runtime.runPromise(
            store.reconcileConfiguration(project, "live", false, at)
          );
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await writing;
          await expect(storage.getAlarm()).resolves.toBeNull();
          await expect(
            scheduled.runtime.runPromise(store.schedule)
          ).resolves.toMatchObject({ nextAlarm: null });
        } finally {
          storage.setAlarm = original;
          await Effect.runPromise(Deferred.succeed(release, undefined));
        }
      }
    );
  });
});
