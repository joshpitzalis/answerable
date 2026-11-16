import { env } from "cloudflare:workers";

import type { Project } from "../features/question-finder/domain";

/** Called only inside server handlers, after the Project slug has been resolved. */
export const scheduledProject = (project: Project) => {
  const mode = env.DISCORD_BOT_TOKEN ? "live" : "fixture";

  return env.PROJECT_HARVEST.getByName(`${mode}:${project.id}`);
};
