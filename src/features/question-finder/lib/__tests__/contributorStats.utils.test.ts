import { describe, expect, it } from "vitest";

import type { ContributorStats } from "../../domain";
import { contributorStatsLabel } from "../contributorStats.utils";

const stats = (
  medianResponses: number,
  plusOneSd: number
): ContributorStats => ({
  medianResponses,
  plusOneSd,
  topContributors: [],
});

describe(contributorStatsLabel, () => {
  it("shows a whole median as a whole number, with the +1 SD count in brackets", () => {
    expect(contributorStatsLabel(stats(3, 7))).toBe(
      "median 3 responses per contributor (7 = +1 SD)"
    );
  });

  it("says 'response' for a median of one", () => {
    expect(contributorStatsLabel(stats(1, 12))).toBe(
      "median 1 response per contributor (12 = +1 SD)"
    );
  });

  it("shows a median between two counts to one decimal", () => {
    expect(contributorStatsLabel(stats(2.5, 4))).toBe(
      "median 2.5 responses per contributor (4 = +1 SD)"
    );
    expect(contributorStatsLabel(stats(1.5, 2))).toBe(
      "median 1.5 responses per contributor (2 = +1 SD)"
    );
  });

  it("says 'responses' for a median below one, which a half can be", () => {
    expect(contributorStatsLabel(stats(0.5, 1))).toBe(
      "median 0.5 responses per contributor (1 = +1 SD)"
    );
  });

  it("shows nothing when there is no statistic", () => {
    expect(contributorStatsLabel(null)).toBeNull();
  });
});
