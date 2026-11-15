import { createServerFn } from "@tanstack/react-start";

import { runtime } from "@/app/runtime";

import type { QuestionsRow } from "./domain";
import { listQuestions as listQuestionsWorkflow } from "./workflows/listQuestions";

export type { QuestionsRow } from "./domain";

/** Below this line is the Worker. On the client this call collapses into a fetch. */
export const listQuestions = createServerFn({ method: "GET" }).handler(
  (): Promise<QuestionsRow[]> => runtime.runPromise(listQuestionsWorkflow())
);
