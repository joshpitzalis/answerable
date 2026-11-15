import { describe, expect, it } from "vitest";

import { contributorStats } from "../domain";

describe(contributorStats, () => {
  it("has no statistic when nobody has contributed", () => {
    expect(contributorStats([])).toBeNull();
  });

  it("gives the mean and the whole count at or above mean plus one standard deviation", () => {
    // Mean 2, population SD sqrt(2) = 1.414, so mean + SD = 3.41 and 4 is the first whole count at or above it.
    expect(contributorStats([1, 1, 4])).toStrictEqual({
      meanResponses: 2,
      plusOneSd: 4,
    });
  });

  it("uses the population standard deviation, not the sample one", () => {
    // Mean 5, population SD exactly 2, so 7. The sample SD (2.14) would give 8.
    expect(contributorStats([2, 4, 4, 4, 5, 5, 7, 9])).toStrictEqual({
      meanResponses: 5,
      plusOneSd: 7,
    });
  });

  it("keeps a mean that is not whole as it is", () => {
    // Mean 1.25, SD 0.433, mean + SD = 1.68, so 2.
    expect(contributorStats([1, 2, 1, 1])).toStrictEqual({
      meanResponses: 1.25,
      plusOneSd: 2,
    });
  });

  it("is the count itself when every contributor wrote the same number", () => {
    expect(contributorStats([3, 3, 3])).toStrictEqual({
      meanResponses: 3,
      plusOneSd: 3,
    });
  });

  it("is that contributor's count when there is only one", () => {
    expect(contributorStats([5])).toStrictEqual({
      meanResponses: 5,
      plusOneSd: 5,
    });
  });
});
