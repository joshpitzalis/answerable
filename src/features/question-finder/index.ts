import { createServerFn } from "@tanstack/react-start";

import { runtime } from "#/app/runtime";

import type { Project, QuestionsReply } from "./domain";
import { findProject } from "./lib/projects.config";
import { listQuestions as listQuestionsWorkflow } from "./workflows/listQuestions";

export type { FailedChannel, QuestionsReply, QuestionsRow } from "./domain";

/** The entry's only parse: a slug becomes a known Project, or the call is refused. */
export const parseProject = (slug: string): Project => {
  const project = findProject(slug);

  if (project === undefined) {
    throw new Error(`Unknown project: ${slug}`);
  }

  return project;
};

export const listQuestions = createServerFn({ method: "GET" })
  .validator(parseProject)
  .handler(({ data: project }): Promise<QuestionsReply> =>
    listQuestionsWorkflow(runtime, project)
  );
