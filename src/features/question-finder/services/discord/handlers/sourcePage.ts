import { Effect, Schema } from "effect";

import type {
  ForumRequest,
  DiscordThread,
  SourcePage,
  ThreadPage,
} from "../../../domain/thread.values";
import { DiscordFailed } from "../lib/errors";
import type { DiscordRateLimited } from "../lib/errors";
import { discordGet } from "./discordGet";
import { RawContent, readMessagePage, toSourceMessage } from "./messagePage";
import type { MessagePageRequest } from "./messagePage";
import { requireMessageAccess } from "./readAccess";

export interface SourcePageRequest extends MessagePageRequest {
  readonly forum?: ForumRequest;
}

const Thread = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/u)),
  parent_id: Schema.String,
  type: Schema.Number,
  name: Schema.String,
  thread_metadata: Schema.Struct({
    archived: Schema.Boolean,
    archive_timestamp: Schema.String.check(
      Schema.makeFilter((value) => Number.isFinite(Date.parse(value)))
    ),
  }),
});

const decodeThreads = (scope: "active" | "archive") =>
  Schema.Struct({
    threads: Schema.Array(Thread),
    has_more:
      scope === "archive" ? Schema.Boolean : Schema.optional(Schema.Boolean),
  });

const starterChannel = (thread: DiscordThread) =>
  thread.isPost === false ? thread.parentChannelId : thread.id;

export const sourcePage = Effect.fn("Discord.sourcePage")(function* (
  request: SourcePageRequest,
  token: string,
  fetch: typeof globalThis.fetch
): Effect.fn.Return<SourcePage, DiscordFailed | DiscordRateLimited> {
  const type = yield* requireMessageAccess(
    request.parentChannelId,
    request.serverId,
    token,
    fetch
  );

  if (request.forum?.kind === "messages") {
    const { thread, before } = request.forum;

    if (thread.parentChannelId !== request.parentChannelId) {
      return yield* Effect.fail(
        new DiscordFailed({
          reason: "Discord thread belongs to another Channel",
        })
      );
    }

    const messages = yield* readMessagePage(
      { ...request, channelId: thread.id, before },
      token,
      fetch
    );

    return { thread, messages };
  }

  if (type === 0 && request.forum === undefined) {
    return yield* readMessagePage(request, token, fetch);
  }

  if (request.forum?.kind === "starter") {
    const { thread } = request.forum;
    const channelId = starterChannel(thread);

    const body = yield* discordGet(
      `/channels/${channelId}/messages/${thread.starterId}`,
      token,
      fetch
    );

    const raw = yield* Schema.decodeUnknownEffect(RawContent)(body).pipe(
      Effect.mapError(
        () => new DiscordFailed({ reason: "Malformed Discord forum starter" })
      )
    );

    if (
      raw.id !== thread.starterId ||
      raw.channel_id !== channelId ||
      thread.parentChannelId !== request.parentChannelId
    ) {
      return yield* Effect.fail(
        new DiscordFailed({
          reason: "Discord returned another thread's starter",
        })
      );
    }

    return {
      starter: {
        ...toSourceMessage(raw, { ...request, channelId }),
        threadId: thread.id,
        isPost: thread.isPost !== false,
      },
    };
  }

  const scope = request.forum?.kind === "archive" ? "archive" : "active";
  const query = new URLSearchParams({ limit: "100" });

  if (request.forum?.kind === "archive" && request.forum.before !== null) {
    query.set("before", request.forum.before);
  }

  const body = yield* discordGet(
    scope === "active"
      ? `/guilds/${request.serverId}/threads/active`
      : `/channels/${request.parentChannelId}/threads/archived/public?${query}`,
    token,
    fetch
  );

  const page = yield* Schema.decodeUnknownEffect(decodeThreads(scope))(
    body
  ).pipe(
    Effect.mapError(
      () => new DiscordFailed({ reason: "Malformed Discord thread discovery" })
    )
  );

  const threads = page.threads.filter(
    (thread) =>
      thread.parent_id === request.parentChannelId &&
      (thread.type === 10 || thread.type === 11)
  );

  if (
    threads.some(
      (thread) => thread.thread_metadata.archived !== (scope === "archive")
    ) ||
    (scope === "archive" && threads.length !== page.threads.length)
  ) {
    return yield* Effect.fail(
      new DiscordFailed({
        reason: "Discord discovery contains an unexpected thread",
      })
    );
  }

  const result: ThreadPage = {
    isForum: type !== 0,
    scope,
    hasMore: page.has_more === true,
    threads: threads.map((thread) => ({
      id: thread.id,
      parentChannelId: thread.parent_id,
      title: thread.name,
      starterId: thread.id,
      archived: thread.thread_metadata.archived,
      archiveTimestamp: thread.thread_metadata.archive_timestamp,
      isPost: type !== 0,
    })),
  };

  return result;
});
