import type {
	DiscordMessage,
	RawMessage,
} from "@/features/question-finder/services/discord/schema";
import { GUILD } from "./constants";

export const toMessage = (raw: RawMessage): DiscordMessage => ({
	id: raw.id,
	threadId: raw.thread?.id ?? raw.id,
	authorName: raw.author.global_name ?? raw.author.username,
	content: raw.content,
	replyCount: raw.thread?.message_count ?? 0,
	createdAt: new Date(raw.timestamp),
	url: `https://discord.com/channels/${raw.thread?.guild_id ?? GUILD}/${raw.channel_id}/${raw.id}`,
});
