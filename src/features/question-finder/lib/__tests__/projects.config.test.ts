import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { findProject, PROJECTS } from "../projects.config";

describe(findProject, () => {
  it("finds the Effect Project by slug", () => {
    expect(findProject("effect")).toStrictEqual(
      Option.some({
        channels: [{ id: "1125094089281511474", name: "effect-help" }],
        label: "Effect",
        ownerName: "josh",
        serverId: "795981131316985866",
        slug: "effect",
      })
    );
  });

  it("finds the XState Project with more than one Channel and its own owner name", () => {
    const xstate = Option.getOrThrow(findProject("xstate"));

    expect(xstate.label).toBe("XState");
    expect(xstate.channels.length).toBeGreaterThan(1);
    expect(xstate.ownerName).not.toBe("josh");
  });

  it("finds nothing for an unknown slug", () => {
    expect(findProject("nope")).toStrictEqual(Option.none());
  });
});

describe("the Project list", () => {
  it("lists Effect first, then XState", () => {
    expect(PROJECTS.map((project) => project.slug)).toStrictEqual([
      "effect",
      "xstate",
    ]);
  });
});
