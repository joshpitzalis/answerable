import type { DiscordMessage } from "@/features/question-finder/services/discord/schema";
// ponytail: '?' is enough for text channels. If these are forum channels every
// thread is already a question and this filter disappears entirely.
export const looksLikeAQuestion = (message: DiscordMessage): boolean =>
	message.content.includes("?");
