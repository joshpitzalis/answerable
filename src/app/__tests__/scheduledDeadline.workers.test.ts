import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { SimulatedClock } from "xstate";

import { Discord } from "../../features/question-finder/services/discord";
import { ScheduledHarvest } from "../../features/question-finder/workflows/scheduledHarvest";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, textProject } from "./harvest.test-utils";
import {
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("scheduled batch deadline", () => {
  it("arms a durable continuation after timing out and reconstructs pending work", async () => {
    const project = textProject("scheduled-deadline");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    const started = Deferred.makeUnsafe<undefined>();
    let interrupted = false;
    const clock = new SimulatedClock();

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("legacy"),
        sourcePage: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              })
            )
          ),
      })
    );

    await withScheduledHarvest(stub, time, wire, async (base, storage) => {
      const scheduled = new ScheduledHarvest(base.runtime, "live", clock);
      await scheduled.activate(project);
      const running = scheduled.alarm(project);
      await Effect.runPromise(Deferred.await(started));
      time.now += 20_000;
      clock.increment(20_000);
      await running;
      expect(interrupted).toBeTruthy();
      await expect(storage.getAlarm()).resolves.toBe(time.now + 1000);
    });
    await evictDurableObject(stub);
    time.now += 1000;
    await withScheduledHarvest(
      stub,
      time,
      discordPage([]),
      async (scheduled) => {
        await scheduled.alarm(project);
        await finishTextDiscovery(scheduled, project, time);
        const saved = await scheduled.read(project);
        expect(saved.harvest.status).toBe("current");
      }
    );
  });
});
