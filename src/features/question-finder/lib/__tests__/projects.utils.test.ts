import { describe, expect, it } from "vitest";

import { findProject, STUB_PROJECTS } from "../projects.utils";

// The example Projects, not the owner's gitignored ones, so the expected
// values hold on any machine.
describe(findProject, () => {
  it("finds the Effect Project by slug", () => {
    expect(findProject("effect", STUB_PROJECTS)).toStrictEqual({
      id: "effect",
      channels: [{ id: "1125094089281511474", name: "effect-help" }],
      label: "Effect",
      ownerName: "josh",
      serverId: "795981131316985866",
      slug: "effect",
    });
  });

  it("finds the XState Project with more than one Channel and its own owner name", () => {
    const xstate = findProject("xstate", STUB_PROJECTS);

    expect(xstate?.label).toBe("XState");
    expect(xstate?.channels.length).toBeGreaterThan(1);
    expect(xstate?.ownerName).not.toBe("josh");
  });

  it("finds nothing for an unknown slug", () => {
    expect(findProject("nope", STUB_PROJECTS)).toBeUndefined();
  });

  it("looks in the list it is given, not the owner's", () => {
    expect(findProject("effect", [])).toBeUndefined();
  });
});

describe("the example Project list", () => {
  it("lists Effect first, then XState", () => {
    expect(STUB_PROJECTS.map((project) => project.slug)).toStrictEqual([
      "effect",
      "xstate",
    ]);
  });
});
