import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { EFFECT_PROJECT } from "../../lib/projects.config.example";
import { activateProjectHarvest } from "../../workflows/activateProjectHarvest";
import { readProjectHarvest } from "../../workflows/readProjectHarvest";
import { refreshProjectHarvest } from "../../workflows/refreshProjectHarvest";
import { HarvestAccess, HarvestAccessError } from "../harvestAccess";

describe("Harvest access failures", () => {
  it.each([
    { operation: "read", workflow: readProjectHarvest },
    { operation: "activate", workflow: activateProjectHarvest },
    { operation: "refresh", workflow: refreshProjectHarvest },
  ])(
    "preserves a typed $operation failure",
    async ({ operation, workflow }) => {
      const cause = new Error("remote unavailable");
      const fail = () => Promise.reject(cause);

      const layer = HarvestAccess.layer(() => ({
        read: fail,
        activate: fail,
        requestHarvest: fail,
      }));

      await expect(
        Effect.runPromise(workflow(EFFECT_PROJECT).pipe(Effect.provide(layer)))
      ).rejects.toMatchObject(new HarvestAccessError({ operation, cause }));
    }
  );
});
