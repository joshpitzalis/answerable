import { env } from "cloudflare:workers";
import { Effect } from "effect";

import type { Project } from "../features/question-finder/domain";
import { HarvestAccess } from "../features/question-finder/services/harvestAccess";

/** Called only inside server handlers, after the Project slug has been resolved. */
export const scheduledProject = (project: Project) => {
  const mode = env.DISCORD_BOT_TOKEN ? "live" : "fixture";

  return env.PROJECT_HARVEST.getByName(`${mode}:${project.id}`);
};

export const runHarvestAccess = <A, E>(
  work: Effect.Effect<A, E, HarvestAccess>
) =>
  Effect.runPromise(
    work.pipe(Effect.provide(HarvestAccess.layer(scheduledProject)))
  );
