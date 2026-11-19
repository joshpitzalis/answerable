/// <reference types="@cloudflare/vitest-plugin/types" />
import { describe, expect, it } from "vitest";

import { XSTATE_PROJECT } from "../../features/question-finder/lib/projects.config.example";
import { activateProjectHarvest } from "../../features/question-finder/workflows/activateProjectHarvest";
import { readProjectHarvest } from "../../features/question-finder/workflows/readProjectHarvest";
import { refreshProjectHarvest } from "../../features/question-finder/workflows/refreshProjectHarvest";
import { runHarvestAccess } from "../projectHarvestClient";

describe("Harvest access composition", () => {
  it("reads without activation, activates once and coalesces manual requests through the native object", async () => {
    const initial = await runHarvestAccess(readProjectHarvest(XSTATE_PROJECT));
    expect(initial).toMatchObject({
      harvest: { status: "new" },
      questions: [],
    });

    const activated = await runHarvestAccess(
      activateProjectHarvest(XSTATE_PROJECT)
    );

    expect(activated.harvest.activatedAt).not.toBeNull();

    const refreshed = await runHarvestAccess(
      refreshProjectHarvest(XSTATE_PROJECT)
    );

    const repeated = await runHarvestAccess(
      refreshProjectHarvest(XSTATE_PROJECT)
    );

    expect(repeated).toStrictEqual(refreshed);
    expect(refreshed.harvest.activatedAt).toBe(activated.harvest.activatedAt);
    await expect(
      runHarvestAccess(readProjectHarvest(XSTATE_PROJECT))
    ).resolves.toStrictEqual(refreshed);
  });
});
