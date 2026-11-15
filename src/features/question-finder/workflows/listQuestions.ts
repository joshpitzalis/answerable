import { Effect } from "effect";
import type { ManagedRuntime } from "effect";

import type { Project, QuestionsReply } from "../domain";
import { contributorStats } from "../domain";
import { Contributions } from "../services/contributions";
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

  const { questions, contributors } = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* QuestionStore;
      const contributions = yield* Contributions;

      return {
        contributors: yield* contributions.contributors(project.slug),
        questions: yield* store.listOpen(project.slug),
      };
    })
  );

  return {
    contributorStats: contributorStats(contributors),
    failedChannels,
    questions,
  };
};
