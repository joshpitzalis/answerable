import { Context, Effect, Layer } from "effect";

import type { DiscordMessage } from "../domain";

export class Contributions extends Context.Service<
  Contributions,
  {
    /** Every message the Harvest read for a Project. A message already recorded is not counted again. */
    readonly record: (
      projectSlug: string,
      messages: readonly DiscordMessage[]
    ) => Effect.Effect<void>;
    /** One entry per contributor: how many responses they wrote in the Project. */
    readonly responseCounts: (projectSlug: string) => Effect.Effect<number[]>;
  }
>()("app/Contributions") {
  // ponytail: in-memory, authors by message id so a re-read is idempotent.
  // Becomes a D1 table with the message id as primary key.
  static readonly stub = Layer.sync(Contributions, () => {
    const authorByMessage = new Map<string, Map<string, string>>();

    return Contributions.of({
      record: (projectSlug, messages) =>
        Effect.sync(() => {
          const authors = authorByMessage.get(projectSlug) ?? new Map();

          for (const message of messages) {
            authors.set(message.id, message.authorName);
          }

          authorByMessage.set(projectSlug, authors);
        }),
      responseCounts: (projectSlug) =>
        Effect.sync(() => {
          const counts = new Map<string, number>();

          for (const author of authorByMessage.get(projectSlug)?.values() ??
            []) {
            counts.set(author, (counts.get(author) ?? 0) + 1);
          }

          return [...counts.values()];
        }),
    });
  });
}
