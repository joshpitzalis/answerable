import type { ManagedRuntime } from "effect";
import type { ActorOptions, AnyActorLogic } from "xstate";
import { createActor, toPromise } from "xstate";

import type { FailedChannel, Project } from "../domain";
import type { HarvestServices } from "./harvestSteps";
import { createProjectHarvestMachine } from "./projectHarvestMachine";

/** What times the waits for a rate-limited Channel; a test passes a simulated one. */
export type HarvestClock = ActorOptions<AnyActorLogic>["clock"];

/**
 * The write side, for one Project: Harvest every Channel and report the ones
 * that failed. The rows go to the store, which is the only thing the read side
 * ever touches. This is what the cron Worker will call.
 *
 * One actor per call, run to completion and stopped; the runtime comes from the
 * caller so a test can supply stub services, and the clock so it can skip waits.
 */
export const harvestQuestions = async (
  runtime: ManagedRuntime.ManagedRuntime<HarvestServices, never>,
  project: Project,
  clock?: HarvestClock
): Promise<FailedChannel[]> => {
  const actor = createActor(createProjectHarvestMachine(runtime), {
    clock,
    input: project,
  });

  actor.start();

  try {
    return await toPromise(actor);
  } finally {
    actor.stop();
  }
};
