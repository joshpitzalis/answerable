import { Effect, Schema } from "effect";

import type {
  ForumRequest,
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

  if (type === 0) {
    if (request.forum !== undefined) {
      return yield* Effect.fail(
        new DiscordFailed({ reason: "Discord Channel is no longer a forum" })
      );
    }

    return yield* readMessagePage(request, token, fetch);
  }

  if (request.forum?.kind === "starter") {
    const { thread } = request.forum;

    const body = yield* discordGet(
      `/channels/${thread.id}/messages/${thread.starterId}`,
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
      raw.channel_id !== thread.id ||
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
        ...toSourceMessage(raw, { ...request, channelId: thread.id }),
        isPost: true,
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
    scope,
    hasMore: page.has_more === true,
    threads: threads.map((thread) => ({
      id: thread.id,
      parentChannelId: thread.parent_id,
      title: thread.name,
      starterId: thread.id,
      archived: thread.thread_metadata.archived,
      archiveTimestamp: thread.thread_metadata.archive_timestamp,
    })),
  };

  return result;
});
