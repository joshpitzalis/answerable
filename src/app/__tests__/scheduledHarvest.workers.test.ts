/// <reference types="@cloudflare/vitest-plugin/types" />
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EFFECT_PROJECT } from "../../features/question-finder/lib/projects.config.example";
import { Discord } from "../../features/question-finder/services/discord";
import { DiscordRateLimited } from "../../features/question-finder/services/discord/lib/errors";
import { projectHarvestStub } from "../projectHarvest";
import { sourceMessage, textProject } from "./harvest.test-utils";
import {
  emptyDiscovery,
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("scheduled Harvest", () => {
  afterEach(() => vi.useRealTimers());

  it("activation survives eviction and a native alarm collects without an open browser", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2_000_000_000_000);

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
    let saved = await stub.read(EFFECT_PROJECT);

    for (
      let batch = 0;
      batch < 20 && saved.harvest.status !== "current";
      batch += 1
    ) {
      vi.setSystemTime(Date.now() + 1000);
      // oxlint-disable-next-line no-await-in-loop -- Each native alarm resumes the preceding batch's committed continuation.
      await runDurableObjectAlarm(stub);
      // oxlint-disable-next-line no-await-in-loop -- Observe completion through the native read boundary.
      saved = await stub.read(EFFECT_PROJECT);
    }

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
        sourcePage: (request) =>
          Effect.gen(function* () {
            const discovery = emptyDiscovery(request);

            if (discovery !== undefined) {
              return discovery;
            }

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
      await finishTextDiscovery(scheduled, project, time);
      const completed = await scheduled.read(project);
      expect(completed.questions).toHaveLength(1);
      await scheduled.request(project);
      const requested = await scheduled.read(project);
      expect(requested.harvest.nextEligibleAt).toBe(2_000_000_060_000);
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
        sourcePage: () =>
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
