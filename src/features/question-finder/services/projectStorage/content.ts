import type { QuestionsRow } from "../../domain";
import type {
  IngestionCounts,
  PageIngestion,
  ProcessingCandidate,
  SourceMessage,
  StoredMessage,
} from "../../domain/harvest.values";
import { saveQuestions } from "./questions";

// oxlint-disable-next-line typescript/consistent-type-definitions -- SQLite rows require an implicit index signature.
type MessageRow = {
  id: string;
  channel_id: string;
  parent_channel_id: string;
  thread_id: string | null;
  author_id: string;
  author_name: string;
  avatar_url: string | null;
  is_bot: number;
  is_webhook: number;
  content: string;
  created_at: string;
  edited_at: string | null;
  reply_count: number;
  is_post: number;
  url: string;
  source_revision: number;
  first_observed_at: number;
  last_observed_at: number;
  deleted_at: number | null;
};

const fromRow = (row: MessageRow): StoredMessage => ({
  id: row.id,
  channelId: row.channel_id,
  parentChannelId: row.parent_channel_id,
  threadId: row.thread_id,
  authorId: row.author_id,
  authorName: row.author_name,
  authorAvatarUrl: row.avatar_url,
  authorIsBot: row.is_bot === 1,
  authorIsWebhook: row.is_webhook === 1,
  content: row.content,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  replyCount: row.reply_count,
  isPost: row.is_post === 1,
  url: row.url,
  sourceRevision: row.source_revision,
  firstObservedAt: row.first_observed_at,
  lastObservedAt: row.last_observed_at,
  deletedAt: row.deleted_at,
});

export const readMessages = (sql: SqlStorage): StoredMessage[] =>
  sql
    .exec<MessageRow>("SELECT * FROM messages ORDER BY length(id), id")
    .toArray()
    .map(fromRow);

const fingerprint = (message: SourceMessage): string =>
  JSON.stringify([
    message.channelId,
    message.parentChannelId,
    message.threadId,
    message.authorId,
    message.authorName,
    message.authorAvatarUrl,
    message.authorIsBot,
    message.authorIsWebhook,
    message.content,
    message.createdAt,
    message.replyCount,
    message.isPost,
    message.url,
  ]);

const ingestMessage = (
  sql: SqlStorage,
  message: SourceMessage,
  page: PageIngestion
): keyof IngestionCounts => {
  const [previous] = sql
    .exec<{
      fingerprint: string;
      source_revision: number;
      deleted_at: number | null;
    }>(
      "SELECT fingerprint, source_revision, deleted_at FROM messages WHERE id = ?",
      message.id
    )
    .toArray();

  const changed =
    previous === undefined ||
    previous.fingerprint !== fingerprint(message) ||
    previous.deleted_at !== null;

  const revision = (previous?.source_revision ?? 0) + Number(changed);
  sql.exec(
    `INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id, parent_channel_id=excluded.parent_channel_id,
    thread_id=excluded.thread_id, author_id=excluded.author_id, author_name=excluded.author_name,
    avatar_url=excluded.avatar_url, is_bot=excluded.is_bot, is_webhook=excluded.is_webhook,
    content=excluded.content, created_at=excluded.created_at, edited_at=excluded.edited_at,
    reply_count=excluded.reply_count, is_post=excluded.is_post, url=excluded.url,
    source_revision=excluded.source_revision, fingerprint=excluded.fingerprint,
    last_observed_at=MAX(messages.last_observed_at, excluded.last_observed_at), deleted_at=NULL`,
    message.id,
    message.channelId,
    message.parentChannelId,
    message.threadId,
    message.authorId,
    message.authorName,
    message.authorAvatarUrl,
    Number(message.authorIsBot),
    Number(message.authorIsWebhook),
    message.content,
    message.createdAt,
    message.editedAt,
    message.replyCount,
    Number(message.isPost),
    message.url,
    revision,
    fingerprint(message),
    page.observedAt,
    page.observedAt
  );
  sql.exec(
    `INSERT INTO processing (message_id, source_revision, policy_revision) VALUES (?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET source_revision=excluded.source_revision,
    policy_revision=excluded.policy_revision, completed=0, failure=NULL
    WHERE source_revision != excluded.source_revision OR policy_revision != excluded.policy_revision`,
    message.id,
    revision,
    page.policyRevision
  );

  if (changed) {
    sql.exec("DELETE FROM questions WHERE id = ?", message.id);
  }

  if (previous === undefined) {
    return "inserted";
  }

  return changed ? "updated" : "unchanged";
};

export const ingestPage = (
  storage: DurableObjectStorage,
  page: PageIngestion
): IngestionCounts =>
  storage.transactionSync(() => {
    const counts = { inserted: 0, updated: 0, unchanged: 0 };

    for (const message of page.messages) {
      if (
        message.channelId !== page.progress.streamId ||
        message.parentChannelId !== page.progress.parentChannelId
      ) {
        throw new Error("Discord page belongs to another stream");
      }

      counts[ingestMessage(storage.sql, message, page)] += 1;
    }

    const { progress } = page;
    storage.sql.exec(
      `INSERT INTO fetch_progress VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stream_id) DO UPDATE SET completed_boundary=excluded.completed_boundary,
    upper_boundary=excluded.upper_boundary, before_id=excluded.before_id, seeded=excluded.seeded,
    last_completed_at=excluded.last_completed_at, failure=excluded.failure`,
      progress.streamId,
      progress.parentChannelId,
      progress.completedBoundary,
      progress.upperBoundary,
      progress.before,
      Number(progress.seeded),
      progress.lastCompletedAt,
      progress.failure
    );

    return counts;
  });

export const pendingCandidates = (
  sql: SqlStorage,
  channelIds: readonly string[]
): ProcessingCandidate[] =>
  sql
    .exec<
      MessageRow & { policy_revision: string }
    >(`SELECT messages.*, processing.policy_revision FROM messages
    JOIN processing ON message_id = id WHERE completed = 0 AND deleted_at IS NULL
    ORDER BY length(id), id`)
    .toArray()
    .filter((row) => channelIds.includes(row.parent_channel_id))
    .map((row) => ({
      message: fromRow(row),
      policyRevision: row.policy_revision,
    }));

export const completeProcessing = (
  storage: DurableObjectStorage,
  candidate: ProcessingCandidate,
  row: QuestionsRow | null
): boolean =>
  storage.transactionSync(() => {
    const changed = storage.sql
      .exec(
        `UPDATE processing SET completed=1, failure=NULL
      WHERE message_id=? AND source_revision=? AND policy_revision=?
      AND EXISTS (SELECT 1 FROM messages WHERE id=message_id AND source_revision=? AND deleted_at IS NULL)
      RETURNING message_id`,
        candidate.message.id,
        candidate.message.sourceRevision,
        candidate.policyRevision,
        candidate.message.sourceRevision
      )
      .toArray();

    if (changed.length === 0) {
      return false;
    }

    if (row === null) {
      storage.sql.exec(
        "DELETE FROM questions WHERE id = ?",
        candidate.message.id
      );
    } else {
      saveQuestions(storage.sql, [row]);
    }

    return true;
  });
