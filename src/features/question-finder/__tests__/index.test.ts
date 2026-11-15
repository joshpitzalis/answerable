import { describe, expect, it } from "vitest";

import { parseProject } from "../index";

describe(parseProject, () => {
  it("resolves a known slug to its Project", () => {
    expect(parseProject("effect")).toMatchObject({
      label: "Effect",
      slug: "effect",
    });
  });

  it("refuses an unknown slug", () => {
    expect(() => parseProject("nope")).toThrow(/unknown project: nope/iu);
  });
});
