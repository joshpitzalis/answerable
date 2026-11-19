import { compareArchiveTimes } from "./values/thread.values";

export const advanceArchivePage = (
  timestamps: readonly string[],
  hasMore: boolean,
  range: {
    readonly before: string | null;
    readonly floor: string;
    readonly upper: string;
  }
) => {
  const [oldest] = timestamps.toSorted(compareArchiveTimes);

  const done =
    !hasMore ||
    (oldest !== undefined && compareArchiveTimes(oldest, range.floor) < 0);

  if (done) {
    return { before: null, floor: range.upper, done: true };
  }

  // Discord's timestamp cursor is exclusive: overlap its least-precise millisecond to retain boundary ties.
  const before =
    oldest === undefined
      ? null
      : new Date(Date.parse(oldest) + 1).toISOString();

  if (
    before === null ||
    (range.before !== null && compareArchiveTimes(before, range.before) >= 0)
  ) {
    return null;
  }

  return { before, floor: range.floor, done: false };
};
