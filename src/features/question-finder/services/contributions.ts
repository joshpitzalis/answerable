import { Context, Effect, Layer } from "effect";

import type { Contributor, DiscordMessage } from "../domain";

export class Contributions extends Context.Service<
  Contributions,
  {
    /** Every response the Harvest read for a Project. A message already recorded is not counted again. */
    readonly record: (
      projectSlug: string,
      messages: readonly DiscordMessage[]
    ) => Effect.Effect<void>;
    /** One entry per contributor: how many responses they wrote, and their latest avatar. */
    readonly contributors: (
      projectSlug: string
    ) => Effect.Effect<Contributor[]>;
  }
>()("app/Contributions") {
  // ponytail: in-memory, by message id so a re-read is idempotent.
  // Becomes a D1 table with the message id as primary key.
  static readonly stub = Layer.sync(Contributions, () => {
    const byMessage = new Map<
      string,
      Map<string, { name: string; avatarUrl: string | null }>
    >();

    return Contributions.of({
      contributors: (projectSlug) =>
        Effect.sync(() => {
          const people = new Map<
            string,
            { responses: number; avatarUrl: string | null; latestId: string }
          >();

          for (const [id, { name, avatarUrl }] of byMessage.get(projectSlug) ??
            []) {
            const person = people.get(name);

            // Snowflakes sort by time (same length until the 2090s, as the cursor relies on).
            const isLatest = person === undefined || id > person.latestId;

            people.set(name, {
              avatarUrl: isLatest ? avatarUrl : person.avatarUrl,
              latestId: isLatest ? id : person.latestId,
              responses: (person?.responses ?? 0) + 1,
            });
          }

          return [...people].map(([name, { avatarUrl, responses }]) => ({
            avatarUrl,
            name,
            responses,
          }));
        }),
      record: (projectSlug, messages) =>
        Effect.sync(() => {
          const recorded = byMessage.get(projectSlug) ?? new Map();

          for (const message of messages) {
            recorded.set(message.id, {
              avatarUrl: message.authorAvatarUrl,
              name: message.authorName,
            });
          }

          byMessage.set(projectSlug, recorded);
        }),
    });
  });
}
