import type { QuestionsReply } from "./index";

export interface SourceMessage {
  readonly id: string;
  readonly channelId: string;
  readonly parentChannelId: string;
  readonly threadId: string | null;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly authorIsBot: boolean;
  readonly authorIsWebhook: boolean;
  readonly content: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly replyCount: number;
  readonly isPost: boolean;
  readonly url: string;
}

export interface StoredMessage extends SourceMessage {
  readonly sourceRevision: number;
  readonly firstObservedAt: number;
  readonly lastObservedAt: number;
  readonly deletedAt: number | null;
}

export interface ProcessingCandidate {
  readonly generation?: number;
  readonly message: StoredMessage;
  readonly policyRevision: string;
  readonly contextRevision: string;
}

export interface FetchProgress {
  readonly generation?: number;
  readonly streamId: string;
  readonly parentChannelId: string;
  readonly completedBoundary: string | null;
  readonly upperBoundary: string | null;
  readonly before: string | null;
  readonly seeded: boolean;
  readonly lastCompletedAt: number | null;
  readonly failure: string | null;
}

export interface HarvestTurn {
  readonly generation: number;
  readonly channelId: string;
}

export interface PageIngestion {
  readonly expectedGeneration?: number;
  readonly messages: readonly SourceMessage[];
  readonly progress: FetchProgress;
  readonly observedAt: number;
  readonly policyRevision: string;
}

export interface IngestionCounts {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
}

export interface HarvestStatus {
  readonly status: "new" | "working" | "waiting" | "current" | "partial";
  readonly activatedAt: number | null;
  readonly lastAttempt: number | null;
  readonly lastCompleteSuccess: number | null;
  readonly initialCoverage: "latest-50";
  readonly pendingProcessing: number;
  readonly nextEligibleAt: number | null;
}

export interface StoredQuestionsReply extends QuestionsReply {
  readonly harvest: HarvestStatus;
}

export const compareSnowflakes = (left: string, right: string): number =>
  left.length - right.length || left.localeCompare(right);

export const activationBoundary = (at: number): string =>
  (BigInt(Math.max(0, at - 1_420_070_400_000)) * 4_194_304n).toString();

export const processingPolicy = (
  mode: "live" | "fixture",
  evidenceRevision = "v1"
): string =>
  mode === "live"
    ? "question-mark-v1:accept-all-v1:replies-off"
    : `question-mark-v1:fixture-judge-v1:evidence-${evidenceRevision}:replies-pending`;
