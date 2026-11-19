import type { SourceMessage } from "./harvest.values";
import type { ReconciliationResult } from "./reconciliation.values";

export interface DiscordThread {
  readonly id: string;
  readonly parentChannelId: string;
  readonly title: string;
  readonly starterId: string;
  readonly archived: boolean;
  readonly archiveTimestamp: string;
  readonly createdAt?: string | null;
  readonly isPost?: boolean;
}

export interface ThreadPage {
  readonly threads: readonly DiscordThread[];
  readonly scope: "active" | "archive";
  readonly hasMore: boolean;
  readonly isForum?: boolean;
}

export type ForumRequest =
  | { readonly kind: "active" }
  | { readonly kind: "archive"; readonly before: string | null }
  | { readonly kind: "starter"; readonly thread: DiscordThread }
  | {
      readonly kind: "messages";
      readonly thread: DiscordThread;
      readonly before: string | null;
    };

export type SourcePage =
  | { readonly reconciliation: ReconciliationResult }
  | readonly SourceMessage[]
  | ThreadPage
  | { readonly starter: SourceMessage }
  | {
      readonly thread: DiscordThread;
      readonly messages: readonly SourceMessage[];
    };

const nanos = (value: string) => {
  const fraction = /\.(?<fraction>\d+)/u.exec(value)?.groups?.fraction ?? "";

  return (
    BigInt(Date.parse(value)) * 1_000_000n +
    BigInt(fraction.padEnd(9, "0").slice(3, 9))
  );
};

export const compareArchiveTimes = (left: string, right: string): number => {
  const delta = nanos(left) - nanos(right);

  return delta < 0n ? -1 : Number(delta > 0n);
};
