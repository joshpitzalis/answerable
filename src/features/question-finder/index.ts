import { createServerFn } from "@tanstack/react-start";

import { runHarvestAccess } from "#/app/projectHarvestClient";
import { activeProjects } from "#/app/runtime";

import type { Project } from "./domain";
import type { StoredQuestionsReply } from "./domain/values/harvest.values";
import { findProject } from "./lib/projects.utils";
import { activateProjectHarvest } from "./workflows/activateProjectHarvest";
import { readProjectHarvest } from "./workflows/readProjectHarvest";
import { refreshProjectHarvest } from "./workflows/refreshProjectHarvest";

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

    return runHarvestAccess(readProjectHarvest(project));
  });

export const activateHarvest = createServerFn({ method: "POST" })
  .validator((slug: string) => parseProject(slug).slug)
  .handler(({ data: slug }): Promise<StoredQuestionsReply> => {
    const project = parseProject(slug, activeProjects());

    return runHarvestAccess(activateProjectHarvest(project));
  });

export const refreshHarvest = createServerFn({ method: "POST" })
  .validator((slug: string) => parseProject(slug).slug)
  .handler(({ data: slug }): Promise<StoredQuestionsReply> => {
    const project = parseProject(slug, activeProjects());

    return runHarvestAccess(refreshProjectHarvest(project));
  });
