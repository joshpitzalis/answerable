export const HARVEST_INTERVAL = 15 * 60_000;
export const MANUAL_COOLDOWN = 60_000;
export const RECOVERY_DELAY = 30_000;
export const CONTINUATION_DELAY = 1000;

export interface HarvestSchedule {
  readonly projectId: string | null;
  readonly mode: "live" | "fixture" | null;
  readonly nextDue: number | null;
  readonly nextAlarm: number | null;
  readonly lastManual: number | null;
  readonly globalPause: number;
  readonly retryCycleAt: number;
  readonly runGeneration: number | null;
}

export interface HarvestRetry {
  readonly kind: "acquisition" | "processing";
  readonly workId: string;
  readonly channelId: string;
  readonly generation?: number;
  readonly reason: string;
  readonly retryAfterMs?: number;
  readonly global?: boolean;
}
