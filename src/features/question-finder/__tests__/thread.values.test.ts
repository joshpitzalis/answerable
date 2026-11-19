import { describe, expect, it } from "vitest";

import { compareArchiveTimes } from "../domain/thread.values";

describe("archive timestamp ordering", () => {
  it.each([
    ["2026-11-01T00:00:00.123456Z", "2026-11-01T00:00:00.123457Z", -1],
    ["2026-11-01T00:00:00.123457Z", "2026-11-01T00:00:00.123456Z", 1],
    ["2026-11-01T00:00:00.1234Z", "2026-11-01T00:00:00.123400Z", 0],
    ["2026-11-01T00:00:00.999999Z", "2026-11-01T00:00:01.000000Z", -1],
    ["2026-11-01T01:00:00+01:00", "2026-11-01T00:00:00.000000Z", 0],
  ])("compares %s with %s", (left, right, expected) => {
    expect(compareArchiveTimes(left, right)).toBe(expected);
  });
});
