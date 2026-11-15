import { describe, expect, it } from "vitest";

import { contributorStatsLabel } from "../contributorStats.utils";

describe(contributorStatsLabel, () => {
  it("shows the mean to one decimal and the +1 SD count in brackets", () => {
    expect(contributorStatsLabel({ meanResponses: 3.2, plusOneSd: 7 })).toBe(
      "avg 3.2 responses per contributor (7 = +1 SD)"
    );
  });

  it("rounds the mean to one decimal", () => {
    expect(contributorStatsLabel({ meanResponses: 2.34, plusOneSd: 4 })).toBe(
      "avg 2.3 responses per contributor (4 = +1 SD)"
    );
  });

  it("keeps the decimal on a whole mean", () => {
    expect(contributorStatsLabel({ meanResponses: 1, plusOneSd: 1 })).toBe(
      "avg 1.0 responses per contributor (1 = +1 SD)"
    );
  });

  it("shows nothing when there is no statistic", () => {
    expect(contributorStatsLabel(null)).toBeNull();
  });
});
