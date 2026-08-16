import { Layer } from "effect";
import { Corpus } from "./corpus";
import { Cursors } from "./cursors";
import { Discord } from "./discord";
import { Judge } from "./judge";
import { QuestionStore } from "./question-store";

/**
 * Service boundaries for the question-finder pipeline.
 *
 * Every layer wired here is `*.stub`. The pipeline in `../server.ts` is real —
 * it is the code that ships. Swapping a stub for a live layer changes nothing
 * above it.
 */

export * from "./corpus";
export * from "./cursors";
export * from "./discord";
export * from "./judge";
export * from "./question-store";

export const stubLayer = Layer.mergeAll(
	Discord.stub,
	Cursors.stub,
	Corpus.stub,
	Judge.stub,
	QuestionStore.stub,
);

// The live wiring lives in ../runtime.ts, not here. This file is reachable from
// the client bundle through server.ts, and `cloudflare:workers` does not resolve
// there.
