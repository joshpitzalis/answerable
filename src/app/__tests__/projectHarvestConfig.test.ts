import { describe, expect, it } from "vitest";

import { EFFECT_PROJECT } from "../../features/question-finder/lib/projects.config.example";
import { resolveHarvestProject } from "../projectHarvestConfig";

describe("trusted Harvest registry selection", () => {
  const live = { ...EFFECT_PROJECT, serverId: "live-server" };
  const fixture = { ...EFFECT_PROJECT, serverId: "fixture-server" };

  const registries = {
    live: [live, { ...live, id: "live-only" }],
    fixture: [fixture, { ...fixture, id: "fixture-only" }],
  };

  it("resolves the same stable ID using the requested mode's trusted metadata", () => {
    expect(resolveHarvestProject("effect", "live", registries)).toStrictEqual(
      live
    );
    expect(
      resolveHarvestProject("effect", "fixture", registries)
    ).toStrictEqual(fixture);
  });

  it("refuses IDs that exist only in the other mode", () => {
    expect(
      resolveHarvestProject("live-only", "fixture", registries)
    ).toBeUndefined();
    expect(
      resolveHarvestProject("fixture-only", "live", registries)
    ).toBeUndefined();
  });
});
