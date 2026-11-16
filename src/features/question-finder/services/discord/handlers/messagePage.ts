import { Effect, Schema } from "effect";

import type { SourceMessage } from "../../../domain/harvest.values";
import { DiscordFailed } from "../lib/errors";
import { discordGet } from "./discordGet";

export interface MessagePageRequest {
  readonly channelId: string;
  readonly parentChannelId: string;
  readonly serverId: string;
  readonly before: string | null;
  readonly limit: number;
}

const DecimalId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/u));

const Timestamp = Schema.String.check(
  Schema.makeFilter((value) => Number.isFinite(Date.parse(value)))
);

export const RawContent = Schema.Struct({
  id: DecimalId,
  channel_id: Schema.String,
  content: Schema.String,
  timestamp: Timestamp,
  edited_timestamp: Schema.optional(Schema.NullOr(Timestamp)),
  webhook_id: Schema.optional(DecimalId),
  author: Schema.Struct({
    id: DecimalId,
    username: Schema.String,
    global_name: Schema.optional(Schema.NullOr(Schema.String)),
    avatar: Schema.optional(Schema.NullOr(Schema.String)),
    bot: Schema.optional(Schema.Boolean),
  }),
  thread: Schema.optional(
    Schema.Struct({
      id: DecimalId,
      message_count: Schema.optional(Schema.Number),
    })
  ),
});

export const readMessagePage = Effect.fn("Discord.readMessagePage")(function* (
  request: MessagePageRequest,
  token: string,
  fetch: typeof globalThis.fetch
) {
  const query = new URLSearchParams({ limit: String(request.limit) });

  if (request.before !== null) {
    query.set("before", request.before);
  }

  const body = yield* discordGet(
    `/channels/${request.channelId}/messages?${query}`,
    token,
    fetch
  );

  const raw = yield* Schema.decodeUnknownEffect(Schema.Array(RawContent))(
    body
  ).pipe(
    Effect.mapError(
      () => new DiscordFailed({ reason: "Malformed Discord message page" })
    )
  );

  if (
    raw.length > request.limit ||
    raw.some((message) => message.channel_id !== request.channelId)
  ) {
    return yield* Effect.fail(
      new DiscordFailed({
        reason: "Discord returned another Channel's messages",
      })
    );
  }

  return raw.map((message) => toSourceMessage(message, request));
});

export const toSourceMessage = (
  message: typeof RawContent.Type,
  request: MessagePageRequest
): SourceMessage => ({
  id: message.id,
  channelId: message.channel_id,
  parentChannelId: request.parentChannelId,
  threadId:
    request.channelId === request.parentChannelId
      ? (message.thread?.id ?? null)
      : request.channelId,
  authorId: message.author.id,
  authorName: message.author.global_name ?? message.author.username,
  authorAvatarUrl: message.author.avatar
    ? `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png?size=64`
    : null,
  authorIsBot: message.author.bot === true,
  authorIsWebhook: message.webhook_id !== undefined,
  content: message.content,
  createdAt: message.timestamp,
  editedAt: message.edited_timestamp ?? null,
  replyCount: message.thread?.message_count ?? 0,
  isPost: false,
  url: `https://discord.com/channels/${request.serverId}/${message.channel_id}/${message.id}`,
});
