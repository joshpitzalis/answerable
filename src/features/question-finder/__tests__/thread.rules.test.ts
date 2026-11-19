import { describe, expect, it } from "vitest";

import { advanceArchivePage } from "../domain/thread.rules";

describe("archive continuation", () => {
  it("advances a middle archive page backwards without completing the range", () => {
    expect(
      advanceArchivePage(["2026-11-16T09:59:00.123456Z"], true, {
        before: "2026-11-16T10:00:00.124Z",
        floor: "2026-11-16T09:00:00.000Z",
        upper: "2026-11-16T11:00:00.000Z",
      })
    ).toStrictEqual({
      before: "2026-11-16T09:59:00.124Z",
      floor: "2026-11-16T09:00:00.000Z",
      done: false,
    });
  });

  it("keeps an empty page pending when Discord says more archives remain", () => {
    expect(
      advanceArchivePage([], true, {
        before: null,
        floor: "2026-11-16T10:00:00.123455Z",
        upper: "2026-11-16T11:00:00.000Z",
      })
    ).toBeNull();
  });

  it("finishes below the retained floor even when Discord has more history", () => {
    expect(
      advanceArchivePage(
        ["2026-11-16T10:00:00.123456Z", "2026-11-16T10:00:00.123454Z"],
        true,
        {
          before: null,
          floor: "2026-11-16T10:00:00.123455Z",
          upper: "2026-11-16T11:00:00.000Z",
        }
      )
    ).toStrictEqual({
      before: null,
      floor: "2026-11-16T11:00:00.000Z",
      done: true,
    });
  });

  it("keeps collecting at the exact retained floor to preserve timestamp ties", () => {
    expect(
      advanceArchivePage(["2026-11-16T10:00:00.123455Z"], true, {
        before: null,
        floor: "2026-11-16T10:00:00.123455Z",
        upper: "2026-11-16T11:00:00.000Z",
      })
    ).toStrictEqual({
      before: "2026-11-16T10:00:00.124Z",
      floor: "2026-11-16T10:00:00.123455Z",
      done: false,
    });
  });

  it("overlaps a sub-millisecond page boundary without truncating the completed floor", () => {
    expect(
      advanceArchivePage(["2026-11-16T10:00:00.123456Z"], true, {
        before: null,
        floor: "2026-11-16T10:00:00.123455Z",
        upper: "2026-11-16T11:00:00.000Z",
      })
    ).toStrictEqual({
      before: "2026-11-16T10:00:00.124Z",
      floor: "2026-11-16T10:00:00.123455Z",
      done: false,
    });
  });

  it("refuses a repeated timestamp page instead of skipping unseen ties", () => {
    expect(
      advanceArchivePage(["2026-11-16T10:00:00.123456Z"], true, {
        before: "2026-11-16T10:00:00.124Z",
        floor: "2026-11-16T09:00:00.000Z",
        upper: "2026-11-16T11:00:00.000Z",
      })
    ).toBeNull();
  });
});
