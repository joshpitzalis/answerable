import { describe, expect, it } from "vitest";

import { activationBoundary } from "../domain/harvest.values";

describe("Discord activation snowflake boundary", () => {
  it.each([
    [1_420_070_400_000, "0"],
    [1_420_070_400_001, "4194304"],
    [1_420_070_400_002, "8388608"],
    [1_420_070_399_999, "0"],
  ])("maps timestamp %i to the first possible snowflake %s", (at, id) => {
    expect(activationBoundary(at)).toBe(id);
  });
});
