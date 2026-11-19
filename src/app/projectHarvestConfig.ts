import type { Project } from "../features/question-finder/domain";
import {
  PROJECTS,
  STUB_PROJECTS,
} from "../features/question-finder/lib/projects.utils";

const trustedRegistries = { live: PROJECTS, fixture: STUB_PROJECTS };

export const resolveHarvestProject = (
  id: string,
  mode: "live" | "fixture",
  registries: Readonly<
    Record<"live" | "fixture", readonly Project[]>
  > = trustedRegistries
): Project | undefined => registries[mode].find((project) => project.id === id);
