import { Effect } from "effect";

import type { Project } from "../domain";
import { QuestionStore } from "../services/question-store";
import { harvestQuestions } from "./harvestQuestions";

/**
 * The read side.
 *
 * ponytail: harvests inline first, because nothing else triggers it yet. Delete
 * that line the day a cron Worker calls `harvestQuestions` on a schedule — the
 * `listOpen` read below is already the final shape.
 */
export const listQuestions = Effect.fn("listQuestions")(function* (
  project: Project
) {
  yield* harvestQuestions(project);

  return yield* QuestionStore.use((store) => store.listOpen(project.slug));
});
