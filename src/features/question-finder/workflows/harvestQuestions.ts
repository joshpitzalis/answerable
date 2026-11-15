import { Effect } from "effect";
import type { ManagedRuntime } from "effect";
import type { ActorOptions, AnyActorLogic } from "xstate";
import { createActor, toPromise } from "xstate";

import type { HarvestReport, Project } from "../domain";
import { funnelLine } from "../domain";
import type { HarvestServices } from "./harvestSteps";
import { createProjectHarvestMachine } from "./projectHarvestMachine";

/** What times the waits for a rate-limited Channel; a test passes a simulated one. */
export type HarvestClock = ActorOptions<AnyActorLogic>["clock"];

/**
 * The write side, for one Project: Harvest every Channel and report the ones
 * that failed, with a funnel per Channel (also logged, one line each). The rows go to the store, which is the only thing the read side
 * ever touches. This is what the cron Worker will call.
 *
 * One actor per call, run to completion (it stops itself at its final state); the runtime comes from the
 * caller so a test can supply stub services, and the clock so it can skip waits.
 */
export const harvestQuestions = (
  runtime: ManagedRuntime.ManagedRuntime<HarvestServices, never>,
  project: Project,
  clock?: HarvestClock
): Promise<HarvestReport> => {
  const actor = createActor(createProjectHarvestMachine(runtime), {
    clock,
    input: project,
  });

  actor.start();

  return toPromise(actor).then(async (report) => {
    // One line per Channel, for whoever reads the server output. Never sent to the browser.
    await runtime.runPromise(
      Effect.gen(function* () {
        for (const funnel of report.funnels) {
          yield* Effect.logInfo(funnelLine(project.slug, funnel));
        }
      })
    );

    return report;
  });
};
