import type { DiscordMessage } from "@/features/question-finder/domain";
import type { RawMessage } from "@/features/question-finder/services/discord/schema";

export const authorNameOf = (raw: RawMessage): string =>
  raw.author.global_name ?? raw.author.username;

/** `fallbackServerId` is the Project's server, for payloads that carry no thread. */
export const toMessage = (
  raw: RawMessage,
  fallbackServerId: string
): DiscordMessage => ({
  id: raw.id,
  threadId: raw.thread?.id ?? raw.id,
  authorName: authorNameOf(raw),
  content: raw.content,
  replyCount: raw.thread?.message_count ?? 0,
  createdAt: new Date(raw.timestamp),
  url: `https://discord.com/channels/${raw.thread?.guild_id ?? fallbackServerId}/${raw.channel_id}/${raw.id}`,
});
