import type { DiscordMessage } from "#/features/question-finder/domain";
import type {
  RawMessage,
  RawPost,
} from "#/features/question-finder/services/discord/schema";

export const authorNameOf = (raw: RawMessage): string =>
  raw.author.global_name ?? raw.author.username;

/** Discord's CDN avatar URL, or `null` when the author has no custom avatar. */
const avatarUrlOf = (raw: RawMessage): string | null => {
  const { id, avatar } = raw.author;

  return id === undefined || avatar === undefined || avatar === null
    ? null
    : `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64`;
};

/** `fallbackServerId` is the Project's server, for payloads that carry no thread. */
export const toMessage = (
  raw: RawMessage,
  fallbackServerId: string
): DiscordMessage => ({
  id: raw.id,
  threadId: raw.thread?.id ?? raw.id,
  authorAvatarUrl: avatarUrlOf(raw),
  authorIsBot: raw.author.bot === true,
  authorName: authorNameOf(raw),
  content: raw.content,
  replyCount: raw.thread?.message_count ?? 0,
  createdAt: new Date(raw.timestamp),
  url: `https://discord.com/channels/${raw.thread?.guild_id ?? fallbackServerId}/${raw.channel_id}/${raw.id}`,
  isPost: false,
});

/** A forum post: its title and first message read as one question, linked to the post. */
export const toPostMessage = (
  post: RawPost,
  first: RawMessage,
  fallbackServerId: string
): DiscordMessage => ({
  id: post.id,
  threadId: post.id,
  authorAvatarUrl: avatarUrlOf(first),
  authorIsBot: first.author.bot === true,
  authorName: authorNameOf(first),
  content: `${post.name}\n\n${first.content}`,
  replyCount: post.message_count ?? 0,
  createdAt: new Date(first.timestamp),
  url: `https://discord.com/channels/${post.guild_id ?? fallbackServerId}/${post.id}`,
  isPost: true,
});
