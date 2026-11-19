import type { QuestionsRow } from "../../domain";
import type { ProcessingCandidate } from "../../domain/values/harvest.values";
import { messageFromRow } from "./content";
import type { MessageRow } from "./content";
import { saveQuestions } from "./questions";
import { clearRetry } from "./retries";
import { readThreadContext } from "./threadContext";

export { invalidateProcessingContext } from "./processingContext";

export const pendingCandidates = (
  sql: SqlStorage,
  channelIds: readonly string[],
  limit: number,
  at = Date.now()
): ProcessingCandidate[] =>
  sql
    .exec<
      MessageRow & {
        policy_revision: string;
        context_revision: string;
        generation: number;
      }
    >(
      `SELECT messages.*, processing.policy_revision, processing.context_revision, harvest_cycle.generation FROM messages
    CROSS JOIN harvest_cycle
    JOIN processing ON message_id = messages.id
    WHERE completed = 0 AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM harvest_configuration WHERE suspended=0 AND
      (channel_ids IS NULL OR messages.parent_channel_id IN (SELECT value FROM json_each(channel_ids))))
    AND messages.parent_channel_id IN (${channelIds.map(() => "?").join(",")})
    AND NOT EXISTS (SELECT 1 FROM harvest_retries WHERE kind='processing' AND work_id=message_id AND generation=harvest_cycle.generation AND (exhausted=1 OR next_due>?))
    ORDER BY length(messages.id), messages.id LIMIT ?`,
      ...channelIds,
      at,
      limit
    )
    .toArray()
    .map((row) => {
      const context = readThreadContext(sql, row.id);

      return {
        message: messageFromRow(row),
        policyRevision: row.policy_revision,
        contextRevision: row.context_revision,
        threadTitle: context?.title ?? null,
        replyCount: context?.replyCount,
        replyAuthors: context?.replyAuthors,
        generation: row.generation,
      };
    });

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
      AND (? IS NULL OR EXISTS (SELECT 1 FROM harvest_cycle WHERE generation=?))
      AND EXISTS (SELECT 1 FROM messages WHERE id=message_id AND source_revision=? AND deleted_at IS NULL)
      RETURNING message_id`,
        candidate.message.id,
        candidate.message.sourceRevision,
        candidate.policyRevision,
        candidate.contextRevision,
        candidate.generation ?? null,
        candidate.generation ?? null,
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

    clearRetry(
      storage.sql,
      "processing",
      candidate.message.id,
      candidate.generation
    );

    return true;
  });
