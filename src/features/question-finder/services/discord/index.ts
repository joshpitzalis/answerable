import { Context, Effect, Layer, Option } from "effect";

import type {
  DiscordMessage,
  Snowflake,
} from "#/features/question-finder/domain";
import {
  authorNameOf,
  toMessage,
} from "#/features/question-finder/services/discord/lib/DTOs";
import type {
  DiscordFailed,
  DiscordRateLimited,
} from "#/features/question-finder/services/discord/lib/errors";

import { fixtureFetch, listMessages } from "./handlers";

const make = (fetch: typeof globalThis.fetch, token: string) => ({
  messagesSince: (
    channelId: string,
    cursor: Option.Option<Snowflake>,
    serverId: string
  ) =>
    listMessages(
      `/channels/${channelId}/messages?limit=10${
        Option.isNone(cursor) ? "" : `&after=${cursor.value}`
      }`,
      token,
      fetch
      // Discord answers newest-first; the pipeline wants oldest-first so the
      // last message it sees is the new cursor.
    ).pipe(
      Effect.map((raw) =>
        raw.map((message) => toMessage(message, serverId)).toReversed()
      )
    ),

  hasReplyFrom: (threadId: string, authorName: string) =>
    listMessages(`/channels/${threadId}/messages?limit=10`, token, fetch).pipe(
      Effect.map((raw) =>
        raw.some((message) => authorNameOf(message) === authorName)
      )
    ),
});

export class Discord extends Context.Service<
  Discord,
  {
    /** Messages newer than `cursor`, oldest first. `None` means "from the beginning". */
    readonly messagesSince: (
      channelId: string,
      cursor: Option.Option<Snowflake>,
      serverId: string
    ) => Effect.Effect<
      readonly DiscordMessage[],
      DiscordFailed | DiscordRateLimited
    >;
    readonly hasReplyFrom: (
      threadId: string,
      authorName: string
    ) => Effect.Effect<boolean, DiscordFailed | DiscordRateLimited>;
  }
>()("app/Discord") {
  /**
   * Token is passed in, never read here — the secret lives in `env`. `fetch` is
   * the wire; a test passes a fake one.
   */
  static readonly layer = (
    token: string,
    fetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args)
  ) => Layer.sync(Discord, () => Discord.of(make(fetch, token)));

  /** Same code — request building, decoding, mapping. Only the wire is faked. */
  static readonly stub = Layer.sync(Discord, () =>
    Discord.of(make(fixtureFetch, "stub-token"))
  );
}
