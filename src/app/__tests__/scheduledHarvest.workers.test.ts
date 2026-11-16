/// <reference types="@cloudflare/vitest-plugin/types" />
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { EFFECT_PROJECT } from "../../features/question-finder/lib/projects.config.example";
import { Discord } from "../../features/question-finder/services/discord";
import { DiscordRateLimited } from "../../features/question-finder/services/discord/lib/errors";
import { projectHarvestStub } from "../projectHarvest";
import { sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("scheduled Harvest", () => {
  it("activation survives eviction and a native alarm collects without an open browser", async () => {
    const stub = projectHarvestStub(
      env.PROJECT_HARVEST,
      EFFECT_PROJECT,
      "fixture"
    );

    const initial = await stub.read(EFFECT_PROJECT);
    await expect(
      runInDurableObject(stub, (_instance, state) => state.storage.getAlarm())
    ).resolves.toBeNull();

    const activated = await stub.activate(EFFECT_PROJECT.id);
    expect([
      initial.harvest.status,
      activated.questions,
      activated.harvest.status,
    ]).toStrictEqual(["new", [], "working"]);
    await evictDurableObject(stub);
    await runDurableObjectAlarm(stub);
    const saved = await stub.read(EFFECT_PROJECT);
    expect(
      saved.questions.some((row) => row.question.includes("clownfish"))
    ).toBeTruthy();
    expect([saved.harvest.status, saved.harvest.nextEligibleAt]).toStrictEqual([
      "current",
      (saved.harvest.lastCompleteSuccess ?? 0) + 900_000,
    ]);
    const unchanged = await stub.activate(EFFECT_PROJECT.id);
    expect(unchanged).toStrictEqual(saved);
  });

  it("manual requests and duplicate alarm delivery join one runner while reads remain available", async () => {
    const project = textProject("concurrent-alarm");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    const started = Deferred.makeUnsafe<undefined>();
    const release = Deferred.makeUnsafe<undefined>();
    let calls = 0;

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("legacy"),
        messagePage: () =>
          Effect.gen(function* () {
            calls += 1;
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);

            return [sourceMessage("101")];
          }),
      })
    );

    await withScheduledHarvest(stub, time, wire, async (scheduled) => {
      await scheduled.activate(project);
      const first = scheduled.alarm(project);
      await Effect.runPromise(Deferred.await(started));
      const during = await scheduled.read(project);
      const repeated = scheduled.alarm(project);
      await scheduled.request(project);
      expect([during.questions, calls]).toStrictEqual([[], 1]);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Promise.all([first, repeated]);
      const completed = await scheduled.read(project);
      expect(completed.questions).toHaveLength(1);
      await scheduled.request(project);
      const requested = await scheduled.read(project);
      expect(requested.harvest.nextEligibleAt).toBe(time.now + 60_000);
      await scheduled.alarm(project);
      expect(calls).toBe(1);
      time.now += 60_000;
      await scheduled.alarm(project);
      expect(calls).toBe(2);
    });
  });

  it("rate-limit deadlines and the two-retry budget survive instance reconstruction", async () => {
    const project = textProject("rate-limited-alarm");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    let calls = 0;

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("legacy"),
        messagePage: () =>
          Effect.suspend(() => {
            calls += 1;

            return Effect.fail(new DiscordRateLimited({ retryAfterMs: 5000 }));
          }),
      })
    );

    await withScheduledHarvest(stub, time, wire, async (scheduled) => {
      await scheduled.activate(project);
      await scheduled.alarm(project);
      const saved = await scheduled.read(project);
      expect(saved.harvest.nextEligibleAt).toBe(time.now + 5000);
    });
    await evictDurableObject(stub);
    await withScheduledHarvest(stub, time, wire, async (scheduled) => {
      await scheduled.alarm(project);
      expect(calls).toBe(1);
      time.now += 5000;
      await scheduled.alarm(project);
      expect(calls).toBe(2);
      time.now += 5000;
      await scheduled.alarm(project);
      const saved = await scheduled.read(project);
      expect([
        calls,
        saved.harvest.status,
        saved.harvest.nextEligibleAt,
      ]).toStrictEqual([3, "partial", time.now + 900_000]);
      time.now += 5000;
      await scheduled.request(project);
      await scheduled.alarm(project);
      expect(calls).toBe(3);
      time.now += 895_000;
      await scheduled.alarm(project);
      expect(calls).toBe(4);
    });
  });
});
