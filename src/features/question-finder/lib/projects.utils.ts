import type { Project } from "../domain";
import { PROJECTS as STUB_PROJECTS } from "./projects.config.example";

type ProjectList = readonly [Project, ...Project[]];

const assertProjectIds = (projects: readonly Project[]): void => {
  const ids = new Set<string>();

  for (const project of projects) {
    if (project.id.trim().length === 0) {
      throw new Error("Empty Project ID in configuration");
    }

    if (ids.has(project.id)) {
      throw new Error("Duplicate Project ID in configuration");
    }

    ids.add(project.id);
  }
};

// `projects.config.ts` is gitignored, so a fresh clone has none: the glob then
// matches nothing and the example Projects stand in.
// Stryker disable all: Vite's compile-time glob requires literal arguments; runtime mutant switches cannot be parsed.
const local = import.meta.glob<{ PROJECTS: ProjectList }>(
  "./projects.config.ts",
  { eager: true }
);
// Stryker restore all

export const PROJECTS: ProjectList =
  local["./projects.config.ts"]?.PROJECTS ?? STUB_PROJECTS;

assertProjectIds(PROJECTS);

assertProjectIds(STUB_PROJECTS);

export { STUB_PROJECTS };

// Plain value, not Option: the routes import this and no Effect code runs in the browser.
export const findProject = (
  slug: string,
  projects: readonly Project[] = PROJECTS
): Project | undefined => {
  assertProjectIds(projects);

  return projects.find((project) => project.slug === slug);
};
