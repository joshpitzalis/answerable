import { createServerFn } from "@tanstack/react-start";
import { Option } from "effect";

import { runtime } from "@/app/runtime";

import type { Project, QuestionsRow } from "./domain";
import { findProject } from "./lib/projects.config";
import { listQuestions as listQuestionsWorkflow } from "./workflows/listQuestions";

export type { QuestionsRow } from "./domain";

/** The entry's only parse: a slug becomes a known Project, or the call is refused. */
export const parseProject = (slug: string): Project =>
  Option.getOrThrowWith(
    findProject(slug),
    () => new Error(`Unknown project: ${slug}`)
  );

/** Below this line is the Worker. On the client this call collapses into a fetch. */
export const listQuestions = createServerFn({ method: "GET" })
  .validator(parseProject)
  .handler(({ data: project }): Promise<QuestionsRow[]> =>
    runtime.runPromise(listQuestionsWorkflow(project))
  );
