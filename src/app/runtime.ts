import { env } from "cloudflare:workers";

import type { Project } from "@/features/question-finder/domain";
import {
  PROJECTS,
  STUB_PROJECTS,
} from "@/features/question-finder/lib/projects.utils";

/**
 * The owner's Projects when a bot token is bound; the example Projects when not,
 * because the fixture only knows the example ids. Call it inside a handler.
 */
export const activeProjects = (): readonly Project[] =>
  env.DISCORD_BOT_TOKEN ? PROJECTS : STUB_PROJECTS;
