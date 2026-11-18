import type { SourceMessage } from "./harvest.values";
import type { DiscordThread } from "./thread.values";

export type ReconciliationRequest =
  | { readonly kind: "recent" }
  | { readonly kind: "message"; readonly messageId: string }
  | { readonly kind: "thread" };

export interface ReconciliationWork {
  readonly workId: string;
  readonly channelId: string;
  readonly streamId: string;
  readonly request: ReconciliationRequest;
}

export type ReconciliationResult =
  | { readonly kind: "messages"; readonly messages: readonly SourceMessage[] }
  | { readonly kind: "deleted"; readonly messageId: string }
  | { readonly kind: "thread"; readonly thread: DiscordThread };

export const reconciliationInterval = 24 * 60 * 60 * 1000;
