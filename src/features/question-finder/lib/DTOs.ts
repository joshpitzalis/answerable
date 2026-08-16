import type { DiscordMessage } from "@/features/question-finder/services/discord/schema";
import type { QuestionsRow } from "../schema";

export const toRow = (message: DiscordMessage): QuestionsRow => ({
	id: message.id,
	name: message.authorName,
	comments: message.replyCount,
	question: message.content,
	dateAsked: message.createdAt,
	url: message.url,
});
