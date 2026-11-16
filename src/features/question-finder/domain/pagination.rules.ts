import { activationBoundary, compareSnowflakes } from "./harvest.values";
import type { FetchProgress, SourceMessage } from "./harvest.values";

export const advanceMessagePage = (
  progress: FetchProgress,
  messages: readonly SourceMessage[],
  at: number,
  generation: number,
  limit: number
): FetchProgress | null => {
  const ids = messages.map((message) => message.id).toSorted(compareSnowflakes);
  const newest = ids.at(-1);

  if (!progress.seeded) {
    return {
      ...progress,
      generation,
      seeded: true,
      completedBoundary: newest ?? activationBoundary(at),
      lastCompletedAt: at,
      failure: null,
    };
  }

  const lower = progress.completedBoundary ?? activationBoundary(at);

  const upper =
    progress.upperBoundary ??
    (newest !== undefined && compareSnowflakes(newest, lower) > 0
      ? newest
      : lower);

  const [oldest] = ids;

  if (
    oldest !== undefined &&
    progress.before !== null &&
    compareSnowflakes(oldest, progress.before) >= 0
  ) {
    return null;
  }

  const complete =
    messages.length < limit ||
    (oldest !== undefined && compareSnowflakes(oldest, lower) <= 0);

  if (complete) {
    return {
      ...progress,
      generation,
      completedBoundary: upper,
      upperBoundary: null,
      before: null,
      lastCompletedAt: at,
      failure: null,
    };
  }

  if (oldest === undefined) {
    return null;
  }

  return { ...progress, upperBoundary: upper, before: oldest, failure: null };
};
