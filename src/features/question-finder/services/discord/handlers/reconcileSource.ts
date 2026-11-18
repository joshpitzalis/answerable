import { Effect, Schema } from "effect";

import type {
  ReconciliationRequest,
  ReconciliationResult,
} from "../../../domain/reconciliation.values";
import { DiscordFailed } from "../lib/errors";
import type { DiscordRateLimited } from "../lib/errors";
import { discordGet } from "./discordGet";
import { RawContent, readMessagePage, toSourceMessage } from "./messagePage";
import type { MessagePageRequest } from "./messagePage";
import { Thread } from "./threadSchema";

// The caller establishes parent access first; public threads inherit those permissions.
export const reconcileSource = Effect.fn("Discord.reconcileSource")(function* (
  request: MessagePageRequest,
  work: ReconciliationRequest,
  parentType: number,
  token: string,
  fetch: typeof globalThis.fetch
): Effect.fn.Return<ReconciliationResult, DiscordFailed | DiscordRateLimited> {
  if (work.kind === "recent") {
    if (request.channelId === request.parentChannelId && parentType !== 0) {
      return { kind: "messages", messages: [] };
    }

    return {
      kind: "messages",
      messages: yield* readMessagePage(
        { ...request, before: null, limit: 50 },
        token,
        fetch
      ),
    };
  }

  if (work.kind === "thread") {
    const thread = yield* discordGet(
      `/channels/${request.channelId}`,
      token,
      fetch
    ).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Thread)),
      Effect.catchTag("SchemaError", () =>
        Effect.fail(
          new DiscordFailed({ reason: "Malformed Discord thread metadata" })
        )
      )
    );

    if (
      thread.id !== request.channelId ||
      thread.parent_id !== request.parentChannelId ||
      (thread.type !== 10 && thread.type !== 11)
    ) {
      return yield* Effect.fail(
        new DiscordFailed({ reason: "Discord returned another thread" })
      );
    }

    return {
      kind: "thread",
      thread: {
        id: thread.id,
        parentChannelId: thread.parent_id,
        title: thread.name,
        starterId: thread.id,
        archived: thread.thread_metadata.archived,
        archiveTimestamp: thread.thread_metadata.archive_timestamp,
        isPost: parentType !== 0,
      },
    };
  }

  return yield* discordGet(
    `/channels/${request.channelId}/messages/${work.messageId}`,
    token,
    fetch
  ).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(RawContent)),
    Effect.flatMap((raw) => {
      if (raw.id !== work.messageId || raw.channel_id !== request.channelId) {
        return Effect.fail(
          new DiscordFailed({ reason: "Discord returned another message" })
        );
      }

      return Effect.succeed<ReconciliationResult>({
        kind: "messages",
        messages: [toSourceMessage(raw, request)],
      });
    }),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(new DiscordFailed({ reason: "Malformed Discord message" }))
    ),
    Effect.catchTag("DiscordFailed", (error) =>
      error.status === 404 && error.code === 10_008
        ? Effect.succeed<ReconciliationResult>({
            kind: "deleted",
            messageId: work.messageId,
          })
        : Effect.fail(error)
    )
  );
});
