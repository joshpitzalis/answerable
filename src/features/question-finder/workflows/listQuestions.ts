import { Effect } from "effect";
import type { ManagedRuntime } from "effect";

import type { Project, QuestionsReply } from "../domain";
import { QuestionStore } from "../services/question-store";
import { harvestQuestions } from "./harvestQuestions";
import type { HarvestServices } from "./harvestSteps";

/**
 * The read side.
 *
 * ponytail: harvests inline first, because nothing else triggers it yet. Delete
 * that line the day a cron Worker calls `harvestQuestions` on a schedule — the
 * `listOpen` read below is already the final shape.
 */
export const listQuestions = async (
  runtime: ManagedRuntime.ManagedRuntime<HarvestServices, never>,
  project: Project
): Promise<QuestionsReply> => {
  const failedChannels = await harvestQuestions(runtime, project);

  const questions = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* QuestionStore;

      return yield* store.listOpen(project.slug);
    })
  );

  return { failedChannels, questions };
};
