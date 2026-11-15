import type { ContributorStats } from "../domain";

/** The headline text beside the table heading, or `null` when there is nothing to say. */
export const contributorStatsLabel = (
  stats: ContributorStats | null
): string | null =>
  stats === null
    ? null
    : `avg ${stats.meanResponses.toFixed(1)} responses per contributor (${stats.plusOneSd} = +1 SD)`;
