import { runInDurableObject } from "cloudflare:test";
import { Clock, Effect, Layer, ManagedRuntime } from "effect";

import type { Project } from "../../features/question-finder/domain";
import type { ThreadPage } from "../../features/question-finder/domain/thread.values";
import { Corpus } from "../../features/question-finder/services/corpus";
import type { Discord } from "../../features/question-finder/services/discord";
import type { SourcePageRequest } from "../../features/question-finder/services/discord/handlers/sourcePage";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { ScheduledHarvest } from "../../features/question-finder/workflows/scheduledHarvest";
import type { ProjectHarvest } from "../projectHarvest";

export const emptyDiscovery = (
  request: SourcePageRequest
): ThreadPage | undefined => {
  const kind = request.forum?.kind;

  return kind === "active" || kind === "archive"
    ? { scope: kind, threads: [], hasMore: false, isForum: false }
    : undefined;
};

export const finishTextDiscovery = async (
  scheduled: ScheduledHarvest,
  project: Project,
  time: { now: number }
) => {
  time.now += 1000;
  await scheduled.alarm(project);
  time.now += 1000;
  await scheduled.alarm(project);
};

export const testClock = (time: { now: number }) =>
  Layer.succeed(
    Clock.Clock,
    Effect.runSync(
      Clock.clockWith((live) =>
        Effect.succeed({
          currentTimeMillisUnsafe: () => time.now,
          currentTimeMillis: Effect.sync(() => time.now),
          currentTimeNanosUnsafe: () => BigInt(time.now) * 1_000_000n,
          currentTimeNanos: Effect.sync(() => BigInt(time.now) * 1_000_000n),
          monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
          monotonicTimeNanos: live.monotonicTimeNanos,
          sleep: (duration) => live.sleep(duration),
        })
      )
    )
  );

export const withScheduledHarvest = <A>(
  stub: DurableObjectStub<ProjectHarvest>,
  time: { now: number },
  discord: Layer.Layer<Discord>,
  use: (
    scheduled: ScheduledHarvest,
    storage: DurableObjectStorage
  ) => Promise<A>,
  judge: Layer.Layer<Judge> = Judge.everythingAnswerable
) =>
  runInDurableObject(stub, async (_instance, state) => {
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        ProjectStorage.layer(state.storage),
        discord,
        judge,
        Corpus.stub,
        testClock(time)
      )
    );

    try {
      return await use(new ScheduledHarvest(runtime, "live"), state.storage);
    } finally {
      await runtime.dispose();
    }
  });
