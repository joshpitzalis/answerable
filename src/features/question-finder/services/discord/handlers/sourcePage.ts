import { Effect, Schema } from "effect";

import type { ReconciliationRequest } from "../../../domain/values/reconciliation.values";
import type {
  ForumRequest,
  SourcePage,
  ThreadPage,
} from "../../../domain/values/thread.values";
import { DiscordFailed } from "../lib/errors";
import type { DiscordRateLimited } from "../lib/errors";
import { discordGet } from "./discordGet";
import { readMessagePage } from "./messagePage";
import type { MessagePageRequest } from "./messagePage";
import { requireMessageAccess } from "./readAccess";
import { readStarter } from "./readStarter";
import { reconcileSource } from "./reconcileSource";
import { Thread } from "./threadSchema";

export interface SourcePageRequest extends MessagePageRequest {
  readonly forum?: ForumRequest;
  readonly reconciliation?: ReconciliationRequest;
}

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

  if (request.reconciliation !== undefined) {
    return {
      reconciliation: yield* reconcileSource(
        request,
        request.reconciliation,
        type,
        token,
        fetch
      ),
    };
  }

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
    return yield* readStarter(request, request.forum.thread, token, fetch);
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
      createdAt: thread.thread_metadata.create_timestamp ?? null,
      isPost: type !== 0,
    })),
  };

  return result;
});
