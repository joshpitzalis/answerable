import type { Project } from "../domain";
import { PROJECTS as STUB_PROJECTS } from "./projects.config.example";

type ProjectList = readonly [Project, ...Project[]];

// `projects.config.ts` is gitignored, so a fresh clone has none: the glob then
// matches nothing and the example Projects stand in.
const local = import.meta.glob<{ PROJECTS: ProjectList }>(
  "./projects.config.ts",
  { eager: true }
);

export const PROJECTS: ProjectList =
  local["./projects.config.ts"]?.PROJECTS ?? STUB_PROJECTS;

export { STUB_PROJECTS };

// Plain value, not Option: the routes import this and no Effect code runs in the browser.
export const findProject = (
  slug: string,
  projects: readonly Project[] = PROJECTS
): Project | undefined => projects.find((project) => project.slug === slug);
