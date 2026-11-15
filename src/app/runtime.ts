import { env } from "cloudflare:workers";
import { Layer, ManagedRuntime } from "effect";

import type { Project } from "@/features/question-finder/domain";
import {
  PROJECTS,
  STUB_PROJECTS,
} from "@/features/question-finder/lib/projects.utils";
import { Corpus } from "@/features/question-finder/services/corpus";
import { Cursors } from "@/features/question-finder/services/cursors";
import { Discord } from "@/features/question-finder/services/discord";
import { Judge } from "@/features/question-finder/services/judge";
import { QuestionStore } from "@/features/question-finder/services/question-store";

/**
 * Worker-only. Nothing may import this at module scope from a file the client
 * bundle can reach — `cloudflare:workers` does not resolve in the browser. It is
 * referenced from inside `.handler()` bodies, which Start strips on the client.
 *
 * Real Discord when a bot token is bound, fixture when not, so `pnpm dev`
 * without `.dev.vars` still runs the whole pipeline.
 *
 * `Layer.suspend` matters: it defers the `env` read to first layer build, which
 * happens inside a request. Reading `env` at module scope throws on the Worker.
 *
 * ponytail: the other four stay stubs. Promote them one at a time.
 */
const appLayer = Layer.mergeAll(
  Layer.suspend(() =>
    env.DISCORD_BOT_TOKEN ? Discord.layer(env.DISCORD_BOT_TOKEN) : Discord.stub
  ),
  Cursors.stub,
  Corpus.stub,
  // The owner has no real Posts yet: with a token bound the stub Posts must not
  // decide what shows. Without one, the stub Judge keeps the fixture honest.
  Layer.suspend(() =>
    env.DISCORD_BOT_TOKEN ? Judge.everythingAnswerable : Judge.stub
  ),
  QuestionStore.stub
);

/**
 * The owner's Projects when a bot token is bound; the example Projects when not,
 * because the fixture only knows the example ids. Call it inside a handler.
 */
export const activeProjects = (): readonly Project[] =>
  env.DISCORD_BOT_TOKEN ? PROJECTS : STUB_PROJECTS;

/** One runtime per Worker isolate. Built on first use, not at import. */
export const runtime = ManagedRuntime.make(appLayer);
