import type { Project } from "../features/question-finder/domain";
import {
  PROJECTS,
  STUB_PROJECTS,
} from "../features/question-finder/lib/projects.utils";

export const resolveHarvestProject = (
  id: string,
  mode: "live" | "fixture"
): Project | undefined =>
  (mode === "live" ? PROJECTS : STUB_PROJECTS).find(
    (project) => project.id === id
  );
