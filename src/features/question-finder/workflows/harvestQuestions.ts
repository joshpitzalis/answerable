import type { ManagedRuntime } from "effect";
import { createActor, toPromise } from "xstate";

import type { FailedChannel, Project } from "../domain";
import type { HarvestServices } from "./harvestSteps";
import { createProjectHarvestMachine } from "./projectHarvestMachine";

/**
 * The write side, for one Project: Harvest every Channel and report the ones
 * that failed. The rows go to the store, which is the only thing the read side
 * ever touches. This is what the cron Worker will call.
 *
 * One actor per call, run to completion and stopped; the runtime comes from the
 * caller so a test can supply stub services.
 */
export const harvestQuestions = async (
  runtime: ManagedRuntime.ManagedRuntime<HarvestServices, never>,
  project: Project
): Promise<FailedChannel[]> => {
  const actor = createActor(createProjectHarvestMachine(runtime), {
    input: project,
  });

  actor.start();

  try {
    return await toPromise(actor);
  } finally {
    actor.stop();
  }
};
