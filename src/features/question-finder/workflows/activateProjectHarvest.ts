import { Effect } from "effect";

import type { Project } from "../domain";
import { HarvestAccess } from "../services/harvestAccess";

export const activateProjectHarvest = (project: Project) =>
  Effect.flatMap(HarvestAccess, (harvest) => harvest.activate(project));
