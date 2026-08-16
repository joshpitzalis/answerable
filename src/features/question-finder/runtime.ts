import { env } from "cloudflare:workers";
import { Layer, ManagedRuntime } from "effect";
import { Corpus, Cursors, Discord, Judge, QuestionStore } from "./services";

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
		env.DISCORD_BOT_TOKEN ? Discord.layer(env.DISCORD_BOT_TOKEN) : Discord.stub,
	),
	Cursors.stub,
	Corpus.stub,
	Judge.stub,
	QuestionStore.stub,
);

/** One runtime per Worker isolate. Built on first use, not at import. */
export const runtime = ManagedRuntime.make(appLayer);
