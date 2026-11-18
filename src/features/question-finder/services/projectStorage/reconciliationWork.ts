import type { Project } from "../../domain";
import { reconciliationInterval } from "../../domain/reconciliation.values";
import type { ReconciliationWork } from "../../domain/reconciliation.values";

export const reconciliationDue = (sql: SqlStorage): number | null =>
  sql
    .exec<{ next_due: number | null }>(
      "SELECT next_due FROM reconciliation_schedule WHERE id=1"
    )
    .one().next_due;

export const enqueueReconciliation = (
  sql: SqlStorage,
  project: Project,
  at: number
): void => {
  sql.exec(
    `UPDATE reconciliation_schedule SET next_due=(SELECT activated_at+? FROM harvest_state WHERE id=1)
    WHERE id=1 AND next_due IS NULL`,
    reconciliationInterval
  );
  const due = reconciliationDue(sql);

  if (
    due === null ||
    due > at ||
    sql.exec("SELECT 1 FROM reconciliation_work LIMIT 1").toArray().length > 0
  ) {
    return;
  }

  for (const channel of project.channels) {
    sql.exec(
      `INSERT OR IGNORE INTO reconciliation_work (work_id,channel_id,stream_id,kind)
      SELECT 'reconcile:recent:'||stream_id,parent_channel_id,stream_id,'recent' FROM fetch_progress
      WHERE stream_id=? AND (is_forum=0 OR is_forum IS NULL)`,
      channel.id
    );
    sql.exec(
      `INSERT OR IGNORE INTO reconciliation_work (work_id,channel_id,stream_id,kind)
      SELECT 'reconcile:recent:'||id,parent_channel_id,id,'recent' FROM discord_threads
      WHERE parent_channel_id=? AND archived=0`,
      channel.id
    );
    sql.exec(
      `INSERT OR IGNORE INTO reconciliation_work (work_id,channel_id,stream_id,kind,message_id)
      SELECT 'reconcile:message:'||m.id,m.parent_channel_id,m.channel_id,'message',m.id
      FROM messages m JOIN questions q ON q.id=m.id WHERE m.parent_channel_id=? AND m.deleted_at IS NULL`,
      channel.id
    );
    sql.exec(
      `INSERT OR IGNORE INTO reconciliation_work (work_id,channel_id,stream_id,kind)
      SELECT 'reconcile:thread:'||t.id,t.parent_channel_id,t.id,'thread'
      FROM discord_threads t JOIN questions q ON q.id=t.starter_id WHERE t.parent_channel_id=?`,
      channel.id
    );
  }

  sql.exec(
    "UPDATE reconciliation_schedule SET next_due=? WHERE id=1",
    at + reconciliationInterval
  );
};

export const reconciliationPending = (
  sql: SqlStorage,
  ids: readonly string[]
): boolean =>
  sql
    .exec(
      `SELECT 1 FROM reconciliation_work WHERE channel_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`,
      ...ids
    )
    .toArray().length > 0;

export const selectReconciliation = (
  sql: SqlStorage,
  channelId: string,
  generation: number,
  at: number
): ReconciliationWork | undefined => {
  const [row] = sql
    .exec<{
      work_id: string;
      channel_id: string;
      stream_id: string;
      kind: "recent" | "message" | "thread";
      message_id: string | null;
    }>(
      `SELECT * FROM reconciliation_work WHERE channel_id=?
    AND NOT EXISTS (SELECT 1 FROM harvest_retries WHERE kind='acquisition' AND work_id=reconciliation_work.work_id
      AND generation=? AND (exhausted=1 OR next_due>?)) ORDER BY last_selected,work_id LIMIT 1`,
      channelId,
      generation,
      at
    )
    .toArray();

  if (row === undefined) {
    return undefined;
  }

  if (row.kind === "message") {
    if (row.message_id === null) {
      throw new Error("Reconciliation message work has no message identity");
    }

    return {
      workId: row.work_id,
      channelId: row.channel_id,
      streamId: row.stream_id,
      request: { kind: "message", messageId: row.message_id },
    };
  }

  return {
    workId: row.work_id,
    channelId: row.channel_id,
    streamId: row.stream_id,
    request: { kind: row.kind },
  };
};
