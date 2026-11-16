import type { QuestionsRow } from "../../domain";
import type { ProcessingCandidate } from "../../domain/harvest.values";
import { messageFromRow } from "./content";
import type { MessageRow } from "./content";
import { saveQuestions } from "./questions";

export const pendingCandidates = (
  sql: SqlStorage,
  channelIds: readonly string[],
  limit: number
): ProcessingCandidate[] =>
  sql
    .exec<
      MessageRow & {
        policy_revision: string;
        context_revision: string;
        thread_title: string | null;
      }
    >(
      `SELECT messages.*, processing.policy_revision, processing.context_revision, discord_threads.title AS thread_title FROM messages
    JOIN processing ON message_id = messages.id
    LEFT JOIN discord_threads ON discord_threads.starter_id=messages.id
    WHERE completed = 0 AND deleted_at IS NULL
    AND messages.parent_channel_id IN (${channelIds.map(() => "?").join(",")})
    ORDER BY length(messages.id), messages.id LIMIT ?`,
      ...channelIds,
      limit
    )
    .toArray()
    .map((row) => ({
      message: messageFromRow(row),
      policyRevision: row.policy_revision,
      contextRevision: row.context_revision,
      threadTitle: row.thread_title,
    }));

export const countPendingCandidates = (
  sql: SqlStorage,
  channelIds: readonly string[]
): number =>
  sql
    .exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM messages JOIN processing ON message_id=id
    WHERE completed=0 AND deleted_at IS NULL
    AND parent_channel_id IN (${channelIds.map(() => "?").join(",")})`,
      ...channelIds
    )
    .one().count;

export const reprocessCandidates = (
  sql: SqlStorage,
  channelIds: readonly string[],
  policyRevision: string
): number =>
  sql.exec(
    `UPDATE processing SET policy_revision=?, completed=0, failure=NULL
        WHERE policy_revision != ? AND message_id IN
        (SELECT id FROM messages WHERE parent_channel_id IN (${channelIds.map(() => "?").join(",")})
        AND deleted_at IS NULL)`,
    policyRevision,
    policyRevision,
    ...channelIds
  ).rowsWritten;

export const invalidateProcessingContext = (
  sql: SqlStorage,
  messageId: string,
  revision: string
): boolean =>
  sql
    .exec(
      `UPDATE processing SET context_revision=?, completed=0, failure=NULL
    WHERE message_id=? AND context_revision != ? RETURNING message_id`,
      revision,
      messageId,
      revision
    )
    .toArray().length > 0;

export const completeProcessing = (
  storage: DurableObjectStorage,
  candidate: ProcessingCandidate,
  row: QuestionsRow | null
): boolean =>
  storage.transactionSync(() => {
    const changed = storage.sql
      .exec(
        `UPDATE processing SET completed=1, failure=NULL
      WHERE message_id=? AND source_revision=? AND policy_revision=? AND context_revision=?
      AND EXISTS (SELECT 1 FROM messages WHERE id=message_id AND source_revision=? AND deleted_at IS NULL)
      RETURNING message_id`,
        candidate.message.id,
        candidate.message.sourceRevision,
        candidate.policyRevision,
        candidate.contextRevision,
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
