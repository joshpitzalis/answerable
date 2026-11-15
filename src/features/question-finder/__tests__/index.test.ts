import { describe, expect, it } from "vitest";

import { parseProject } from "../index";
import { STUB_PROJECTS } from "../lib/projects.utils";

describe(parseProject, () => {
  it("resolves a known slug to its Project", () => {
    expect(parseProject("effect", STUB_PROJECTS)).toMatchObject({
      label: "Effect",
      slug: "effect",
    });
  });

  it("refuses an unknown slug", () => {
    expect(() => parseProject("nope", STUB_PROJECTS)).toThrow(
      /unknown project: nope/iu
    );
  });

  it("refuses a slug that is not in the list it is given", () => {
    expect(() => parseProject("effect", [])).toThrow(
      /unknown project: effect/iu
    );
  });
});
