import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { findProject } from "../projects.config";

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

  it("finds nothing for an unknown slug", () => {
    expect(findProject("xstate")).toStrictEqual(Option.none());
  });
});
