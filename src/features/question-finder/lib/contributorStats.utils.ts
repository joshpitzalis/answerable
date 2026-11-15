import type { ContributorStats } from "../domain";

/** The headline text beside the table heading, or `null` when there is nothing to say. */
export const contributorStatsLabel = (
  stats: ContributorStats | null
): string | null => {
  if (stats === null) {
    return null;
  }

  const { medianResponses, plusOneSd } = stats;

  // A median is a count or halfway between two counts.
  const median = Number.isInteger(medianResponses)
    ? String(medianResponses)
    : medianResponses.toFixed(1);

  return `median ${median} ${medianResponses === 1 ? "response" : "responses"} per contributor (${plusOneSd} = +1 SD)`;
};
