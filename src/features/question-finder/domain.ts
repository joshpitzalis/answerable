import { Schema } from "effect";

/** Discord snowflake. Sorts lexicographically by time, which is why it works as a cursor. */
export type Snowflake = string;

export const DiscordMessage = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  authorName: Schema.String,
  /** Discord marks bot and webhook accounts; they are not counted as contributors. */
  authorIsBot: Schema.Boolean,
  /** CDN image URL of the author's avatar, or `null` when Discord gave no avatar hash. */
  authorAvatarUrl: Schema.NullOr(Schema.String),
  content: Schema.String,
  replyCount: Schema.Number,
  createdAt: Schema.Date,
  /** Deep link to the message in the Discord client. */
  url: Schema.String,
  /** A forum post (title and first message) rather than a message in a text Channel. */
  isPost: Schema.Boolean,
});

export type DiscordMessage = Schema.Schema.Type<typeof DiscordMessage>;

export const Channel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export type Channel = Schema.Schema.Type<typeof Channel>;

/** A library community: one Discord server, the Channels read in it, and who "I" am there. */
export interface Project {
  readonly slug: string;
  readonly label: string;
  readonly serverId: string;
  readonly channels: readonly Channel[];
  readonly ownerName: string;
}

export const QuestionsRow = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  channel: Channel,
  name: Schema.String,
  comments: Schema.Number,
  /** Markdown. For a forum post, `"{title}\n\n{first message}"`. */
  question: Schema.String,
  /** The question starts with a forum post's title, which the table shows as a title. */
  isPost: Schema.Boolean,
  /** The asker's Discord avatar image, when they have one. */
  avatarUrl: Schema.NullOr(Schema.String),
  dateAsked: Schema.Date,
  url: Schema.String,
});

export type QuestionsRow = Schema.Schema.Type<typeof QuestionsRow>;

/** A Channel the Harvest could not read, for the page to name. Plain data. */
export interface FailedChannel {
  readonly name: string;
  readonly reason: string;
}

/** The steps of one Channel's Harvest, in order. */
export type HarvestStep = "fetching" | "checkingReplies" | "judging" | "saving";

/**
 * What one Channel's Harvest did, as plain counts: each is how many were left
 * after that step. A failed Channel keeps the counts it reached. Server logs
 * only; never sent to the browser.
 */
export interface ChannelFunnel {
  readonly channel: string;
  /** Messages read from Discord (posts, for a forum Channel). */
  readonly read: number;
  /** Of those, how many looked like a question. */
  readonly questions: number;
  /** Of those, how many the owner has not already replied to. */
  readonly unanswered: number;
  /** Of those, how many the Judge kept, and so saved. */
  readonly kept: number;
  /** The step and reason when the Channel failed, else `null`. */
  readonly failure: {
    readonly step: HarvestStep;
    readonly reason: string;
  } | null;
}

/** What a Project Harvest reports: the failed Channels and a funnel per Channel. */
export interface HarvestReport {
  readonly failed: FailedChannel[];
  readonly funnels: ChannelFunnel[];
}

/** One log line for a Channel's funnel. */
export const funnelLine = (slug: string, funnel: ChannelFunnel): string =>
  funnel.failure === null
    ? `harvest ${slug}/${funnel.channel} read=${funnel.read} questions=${funnel.questions} unanswered=${funnel.unanswered} kept=${funnel.kept}`
    : `harvest ${slug}/${funnel.channel} failed in ${funnel.failure.step}: ${funnel.failure.reason}`;

/** One person's responses in a Project. Plain data. */
export interface Contributor {
  readonly name: string;
  readonly responses: number;
  /** Image URL from their most recent message, or `null` when they have none. */
  readonly avatarUrl: string | null;
}

/** How much each contributor has written in a Project, as plain numbers. */
export interface ContributorStats {
  /** Median responses per contributor, unrounded. */
  readonly medianResponses: number;
  /** The smallest whole number of responses at or above mean + 1 standard deviation. */
  readonly plusOneSd: number;
  /** The five with the most responses, most first; ties by name A to Z. */
  readonly topContributors: readonly Contributor[];
}

/** What the server function replies with. Plain data: failures are not thrown. */
export interface QuestionsReply {
  readonly questions: QuestionsRow[];
  readonly failedChannels: FailedChannel[];
  /** `null` until a response has been read. */
  readonly contributorStats: ContributorStats | null;
}

const TOP_CONTRIBUTORS = 5;

const medianOf = (sorted: readonly number[]): number => {
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const contributorStats = (
  contributors: readonly Contributor[]
): ContributorStats | null => {
  if (contributors.length === 0) {
    return null;
  }

  const counts = contributors.map(({ responses }) => responses);
  const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;

  // Population SD: the contributors are everyone read, not a sample of them.
  const variance =
    counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / counts.length;

  return {
    medianResponses: medianOf(counts.toSorted((a, b) => a - b)),
    plusOneSd: Math.ceil(mean + Math.sqrt(variance)),
    topContributors: contributors
      .toSorted(
        (a, b) => b.responses - a.responses || a.name.localeCompare(b.name)
      )
      .slice(0, TOP_CONTRIBUTORS),
  };
};

// ponytail: '?' is enough for text channels. A forum post is a question by
// being a post, so it skips the rule.
export const looksLikeAQuestion = (message: DiscordMessage): boolean =>
  message.isPost || message.content.includes("?");

export const toRow = (
  message: DiscordMessage,
  project: Project,
  channel: Channel
): QuestionsRow => ({
  id: message.id,
  project: project.slug,
  channel,
  name: message.authorName,
  comments: message.replyCount,
  question: message.content,
  isPost: message.isPost,
  avatarUrl: message.authorAvatarUrl,
  dateAsked: message.createdAt,
  url: message.url,
});
