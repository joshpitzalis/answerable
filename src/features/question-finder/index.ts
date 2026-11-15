import { createServerFn } from "@tanstack/react-start";

import { activeProjects, runtime } from "#/app/runtime";

import type { Project, QuestionsReply } from "./domain";
import { findProject } from "./lib/projects.utils";
import { listQuestions as listQuestionsWorkflow } from "./workflows/listQuestions";

export type { FailedChannel, QuestionsReply, QuestionsRow } from "./domain";

/** The entry's only parse: a slug becomes a known Project, or the call is refused. */
export const parseProject = (
  slug: string,
  projects?: readonly Project[]
): Project => {
  const project = findProject(slug, projects);

  if (project === undefined) {
    throw new Error(`Unknown project: ${slug}`);
  }

  return project;
};

export const listQuestions = createServerFn({ method: "GET" })
  .validator((slug: string) => parseProject(slug).slug)
  // Which Projects are live depends on the token, which only the handler may read.
  .handler(({ data: slug }): Promise<QuestionsReply> =>
    listQuestionsWorkflow(runtime, parseProject(slug, activeProjects()))
  );
