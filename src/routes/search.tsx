import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { useState } from "react";
import { Embedder, runtime } from "#/features/embedder.ts";

const SearchInput = Schema.Struct({ query: Schema.String });

/**
 * ─── THE SEAM ────────────────────────────────────────────────────────────────
 *
 * Below this line is the Worker. The body of .handler() is compiled into the
 * server bundle; on the client this whole call collapses into a fetch.
 *
 * Effect starts and finishes inside runPromise. What crosses the wire is plain
 * JSON, so failures leave as data — a tagged union — not as a thrown Cause.
 * Throwing here would reach the browser as a stringified stack with no types.
 */
export const embedQuery = createServerFn({ method: "POST" })
	.validator(Schema.decodeUnknownSync(SearchInput))
	.handler(({ data }) =>
		runtime.runPromise(
			Embedder.use((embedder) => embedder.embed(data.query)).pipe(
				Effect.map((vector) => ({
					_tag: "Embedded" as const,
					dimensions: vector.length,
					preview: vector.slice(0, 4),
				})),
				Effect.catchTag("EmbeddingFailed", (error) =>
					Effect.succeed({ _tag: "Failed" as const, reason: error.reason }),
				),
			),
		),
	);

/**
 * ─── ABOVE THE SEAM ──────────────────────────────────────────────────────────
 *
 * Browser only. No Effect import is needed to call the server — `embedQuery`
 * is just an async function here, and `result` is just data.
 */
export const Route = createFileRoute("/search")({ component: SearchPage });

type Result = Awaited<ReturnType<typeof embedQuery>>;

function SearchPage() {
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<Result | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setPending(true);
		setResult(await embedQuery({ data: { query } }));
		setPending(false);
	}

	return (
		<main className="page-wrap px-4 pb-8 pt-14">
			<section className="island-shell rounded-2xl p-6">
				<p className="island-kicker mb-2">Seam Check</p>
				<h1 className="mb-5 text-2xl font-bold text-[var(--sea-ink)]">
					Embed a query
				</h1>

				<form onSubmit={onSubmit} className="mb-5 flex gap-2">
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="anything at all"
						className="flex-1 rounded-full border border-[rgba(23,58,64,0.2)] bg-white/50 px-4 py-2 text-sm"
					/>
					<button
						type="submit"
						disabled={pending || query.length === 0}
						className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2 text-sm font-semibold text-[var(--lagoon-deep)] disabled:opacity-40"
					>
						{pending ? "Embedding…" : "Embed"}
					</button>
				</form>

				{result?._tag === "Embedded" && (
					<p className="m-0 text-sm text-[var(--sea-ink-soft)]">
						{result.dimensions} dimensions, starting{" "}
						<code>{result.preview.map((n) => n.toFixed(3)).join(", ")}</code>
					</p>
				)}
				{result?._tag === "Failed" && (
					<p className="m-0 text-sm text-red-700">{result.reason}</p>
				)}
			</section>
		</main>
	);
}
