import { createServerFn } from "@tanstack/react-start";

import { scheduledProject } from "#/app/projectHarvestClient";
import { activeProjects } from "#/app/runtime";

import type { Project } from "./domain";
import type { StoredQuestionsReply } from "./domain/harvest.values";
import { findProject } from "./lib/projects.utils";

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
  .handler(({ data: slug }): Promise<StoredQuestionsReply> => {
    const project = parseProject(slug, activeProjects());

    return scheduledProject(project).read(project);
  });

export const activateHarvest = createServerFn({ method: "POST" })
  .validator((slug: string) => parseProject(slug).slug)
  .handler(({ data: slug }): Promise<StoredQuestionsReply> => {
    const project = parseProject(slug, activeProjects());

    return scheduledProject(project).activate(project.id);
  });

export const refreshHarvest = createServerFn({ method: "POST" })
  .validator((slug: string) => parseProject(slug).slug)
  .handler(({ data: slug }): Promise<StoredQuestionsReply> => {
    const project = parseProject(slug, activeProjects());

    return scheduledProject(project).requestHarvest(project);
  });
