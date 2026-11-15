import { describe, expect, it } from "vitest";

import { formatAbsolute, formatRelative, humanizeDate } from "../format-date";

const NOW = new Date("2026-08-16T12:00:00Z");

describe(formatRelative, () => {
  it("counts whole days in the past", () => {
    expect(formatRelative(new Date("2026-08-13T12:00:00Z"), NOW)).toBe(
      "3 days ago"
    );
  });

  it("counts hours in the future", () => {
    expect(formatRelative(new Date("2026-08-16T14:00:00Z"), NOW)).toBe(
      "in 2 hours"
    );
  });

  it("picks the largest unit that fits", () => {
    expect(formatRelative(new Date("2026-06-17T12:00:00Z"), NOW)).toBe(
      "2 months ago"
    );
  });

  it("says just now under a minute", () => {
    expect(formatRelative(new Date("2026-08-16T11:59:30Z"), NOW)).toBe(
      "just now"
    );
  });
});

describe(formatAbsolute, () => {
  it("writes day, month name and year", () => {
    expect(formatAbsolute(new Date("2026-08-16T12:00:00Z"))).toBe(
      "16 August 2026"
    );
  });
});

describe(humanizeDate, () => {
  it("stays relative inside a week", () => {
    expect(humanizeDate(new Date("2026-08-10T12:00:00Z"), NOW)).toBe(
      "6 days ago"
    );
  });

  it("turns absolute at exactly a week", () => {
    expect(humanizeDate(new Date("2026-08-09T12:00:00Z"), NOW)).toBe(
      "9 August 2026"
    );
  });
});
