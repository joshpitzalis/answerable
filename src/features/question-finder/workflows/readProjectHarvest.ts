import { Effect } from "effect";

import type { Project } from "../domain";
import { HarvestAccess } from "../services/harvestAccess";

export const readProjectHarvest = (project: Project) =>
  Effect.flatMap(HarvestAccess, (harvest) => harvest.read(project));
