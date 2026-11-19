import { Context, Effect, Layer, Option } from "effect";

import type {
  DiscordMessage,
  Snowflake,
} from "#/features/question-finder/domain";
import {
  authorNameOf,
  toMessage,
  toPostMessage,
} from "#/features/question-finder/services/discord/lib/DTOs";
import type {
  DiscordFailed,
  DiscordRateLimited,
} from "#/features/question-finder/services/discord/lib/errors";

import type { SourcePage } from "../../domain/values/thread.values";
import {
  fixtureFetch,
  isPostChannel,
  listMessages,
  listPosts,
  POST_PAGE,
} from "./handlers";
import { sourcePage } from "./handlers/sourcePage";
import type { SourcePageRequest } from "./handlers/sourcePage";

export { DiscordFailed } from "./lib/errors";

/** Snowflakes of different lengths still order by time: longer is newer. */
const isNewer = (id: Snowflake, cursor: Snowflake) =>
  id.length === cursor.length ? id > cursor : id.length > cursor.length;

const make = (fetch: typeof globalThis.fetch, token: string) => {
  // Which Channels are forums, asked once each for the life of this service.
  const postChannels = new Map<string, boolean>();

  const isPostChannelCached = (channelId: string) => {
    const known = postChannels.get(channelId);

    return known === undefined
      ? isPostChannel(channelId, token, fetch).pipe(
          Effect.tap((isPost) =>
            Effect.sync(() => postChannels.set(channelId, isPost))
          )
        )
      : Effect.succeed(known);
  };

  const postsSince = Effect.fn("Discord.postsSince")(function* (
    channelId: string,
    cursor: Option.Option<Snowflake>,
    serverId: string
  ) {
    const isNew = (post: { readonly id: Snowflake }) =>
      Option.isNone(cursor) || isNewer(post.id, cursor.value);

    const firstPage = yield* listPosts(channelId, token, fetch);

    // A second page only when Discord has more and nothing on this one is old.
    const secondPage =
      firstPage.has_more === true && firstPage.threads.every(isNew)
        ? yield* listPosts(channelId, token, fetch, POST_PAGE)
        : undefined;

    const pages =
      secondPage === undefined ? [firstPage] : [firstPage, secondPage];

    const firstMessages = pages.flatMap((page) => page.first_messages ?? []);

    return (
      pages
        .flatMap((page) => page.threads)
        .filter(isNew)
        .flatMap((post) => {
          const first = firstMessages.find((message) => message.id === post.id);

          return first === undefined
            ? []
            : [toPostMessage(post, first, serverId)];
        })
        // Newest first from Discord; oldest first for the pipeline.
        .toReversed()
    );
  });

  const textMessagesSince = (
    channelId: string,
    cursor: Option.Option<Snowflake>,
    serverId: string
  ) =>
    listMessages(
      `/channels/${channelId}/messages?limit=50${
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
    );

  return {
    sourcePage: (request: SourcePageRequest) =>
      sourcePage(request, token, fetch),
    messagesSince: (
      channelId: string,
      cursor: Option.Option<Snowflake>,
      serverId: string
    ) =>
      isPostChannelCached(channelId).pipe(
        Effect.flatMap((isPost) =>
          isPost
            ? postsSince(channelId, cursor, serverId)
            : textMessagesSince(channelId, cursor, serverId)
        )
      ),

    hasReplyFrom: (threadId: string, authorName: string) =>
      listMessages(
        `/channels/${threadId}/messages?limit=10`,
        token,
        fetch
      ).pipe(
        Effect.map((raw) =>
          raw.some((message) => authorNameOf(message) === authorName)
        )
      ),
  };
};

export class Discord extends Context.Service<
  Discord,
  {
    readonly sourcePage: (
      request: SourcePageRequest
    ) => Effect.Effect<SourcePage, DiscordFailed | DiscordRateLimited>;
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

  /**
   * The live client with the already-replied check switched off: nobody ever
   * counts as having replied, and no request is made for it. The owner wants
   * one fewer Discord call per question until the rate limits are understood;
   * wire `layer` again to bring the check back.
   */
  static readonly layerSkippingReplyCheck = (
    token: string,
    fetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args)
  ) =>
    Layer.sync(Discord, () =>
      Discord.of({
        ...make(fetch, token),
        hasReplyFrom: () => Effect.succeed(false),
      })
    );

  /** Same code — request building, decoding, mapping. Only the wire is faked. */
  static readonly stub = Layer.sync(Discord, () =>
    Discord.of(make(fixtureFetch, "stub-token"))
  );
}
