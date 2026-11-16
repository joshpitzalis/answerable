import type { SourceMessage } from "./harvest.values";

export interface DiscordThread {
  readonly id: string;
  readonly parentChannelId: string;
  readonly title: string;
  readonly starterId: string;
  readonly archived: boolean;
  readonly archiveTimestamp: string;
}

export interface ThreadPage {
  readonly threads: readonly DiscordThread[];
  readonly scope: "active" | "archive";
  readonly hasMore: boolean;
}

export type ForumRequest =
  | { readonly kind: "archive"; readonly before: string | null }
  | { readonly kind: "starter"; readonly thread: DiscordThread };

export type SourcePage =
  | readonly SourceMessage[]
  | ThreadPage
  | { readonly starter: SourceMessage };

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
