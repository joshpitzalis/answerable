import type { SourceMessage } from "../../domain/harvest.values";
import type {
  ReconciliationResult,
  ReconciliationWork,
} from "../../domain/reconciliation.values";
import { ingestMessage } from "./content";
import { readCycle } from "./cycle";
import { saveThread } from "./forumState";
import { readProgress } from "./progress";
import { clearRetry } from "./retries";
import { invalidateThreadContext } from "./threadContext";

const invalidateAffectedThread = (sql: SqlStorage, messageId: string): void => {
  for (const thread of sql
    .exec<{ starter_id: string }>(
      `SELECT t.starter_id FROM discord_threads t JOIN messages m ON m.thread_id=t.id OR m.id=t.starter_id WHERE m.id=?`,
      messageId
    )
    .toArray()) {
    invalidateThreadContext(sql, thread.starter_id);
  }
};

const ingestObserved = (
  sql: SqlStorage,
  work: ReconciliationWork,
  messages: readonly SourceMessage[],
  policyRevision: string,
  at: number
): void => {
  const progress = readProgress(sql, work.streamId);

  for (const message of messages) {
    if (
      message.channelId !== work.streamId ||
      message.parentChannelId !== work.channelId ||
      (work.request.kind === "message" && message.id !== work.request.messageId)
    ) {
      throw new Error("Reconciliation returned another stream's content");
    }

    const [previous] = sql
      .exec<{ channel_id: string; thread_id: string | null }>(
        "SELECT channel_id,thread_id FROM messages WHERE id=?",
        message.id
      )
      .toArray();

    // A text thread's system starter must not replace its original parent message.
    if (previous !== undefined && previous.channel_id !== message.channelId) {
      continue;
    }

    const [thread] = sql
      .exec<{ id: string; is_post: number }>(
        "SELECT id,is_post FROM discord_threads WHERE starter_id=?",
        message.id
      )
      .toArray();

    const observed = {
      ...message,
      threadId: thread?.id ?? previous?.thread_id ?? message.threadId,
      isPost: thread === undefined ? message.isPost : thread.is_post === 1,
    };

    ingestMessage(sql, observed, {
      messages: [observed],
      progress,
      observedAt: at,
      policyRevision,
    });
    invalidateAffectedThread(sql, message.id);
  }
};

export const saveReconciliation = (
  storage: DurableObjectStorage,
  work: ReconciliationWork,
  generation: number,
  result: ReconciliationResult,
  policyRevision: string,
  at: number
): void =>
  storage.transactionSync(() => {
    const { sql } = storage;

    if (
      readCycle(sql).generation !== generation ||
      sql
        .exec("SELECT 1 FROM reconciliation_work WHERE work_id=?", work.workId)
        .toArray().length === 0
    ) {
      return;
    }

    if (result.kind === "deleted") {
      if (
        work.request.kind !== "message" ||
        work.request.messageId !== result.messageId
      ) {
        throw new Error("Deletion does not match known-message reconciliation");
      }

      sql.exec(
        `UPDATE messages SET source_revision=source_revision+CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END,
      deleted_at=COALESCE(deleted_at,?),last_observed_at=MAX(last_observed_at,?)
      WHERE id=? AND channel_id=? AND parent_channel_id=?`,
        at,
        at,
        result.messageId,
        work.streamId,
        work.channelId
      );
      sql.exec("DELETE FROM questions WHERE id=?", result.messageId);
      invalidateAffectedThread(sql, result.messageId);
    } else if (result.kind === "thread") {
      if (
        work.request.kind !== "thread" ||
        result.thread.id !== work.streamId ||
        result.thread.parentChannelId !== work.channelId
      ) {
        throw new Error("Reconciliation returned another thread's metadata");
      }

      saveThread(sql, result.thread, at);
    } else {
      if (work.request.kind === "thread") {
        throw new Error("Thread metadata reconciliation returned messages");
      }

      ingestObserved(sql, work, result.messages, policyRevision, at);
    }

    clearRetry(sql, "acquisition", work.workId, generation);
    sql.exec("DELETE FROM reconciliation_work WHERE work_id=?", work.workId);
  });
