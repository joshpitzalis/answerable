import {
  CONTINUATION_DELAY,
  HARVEST_INTERVAL,
} from "../../domain/schedule.values";
import type { HarvestRetry } from "../../domain/schedule.values";
import { acquisitionWork } from "./acquisitionWork";

export const workEligible = (
  sql: SqlStorage,
  kind: HarvestRetry["kind"],
  workId: string,
  generation: number,
  at: number
): boolean =>
  sql
    .exec<{ blocked: number }>(
      "SELECT 1 AS blocked FROM harvest_retries WHERE kind=? AND work_id=? AND generation=? AND (exhausted=1 OR next_due>?)",
      kind,
      workId,
      generation,
      at
    )
    .toArray().length === 0;

export const recordRetry = (
  storage: DurableObjectStorage,
  retry: HarvestRetry,
  at: number
): void =>
  storage.transactionSync(() => {
    const { generation } = storage.sql
      .exec<{ generation: number }>(
        "SELECT generation FROM harvest_cycle WHERE id=1"
      )
      .one();

    if (retry.generation !== undefined && retry.generation !== generation) {
      return;
    }

    const [previous] = storage.sql
      .exec<{ attempts: number }>(
        "SELECT attempts FROM harvest_retries WHERE kind=? AND work_id=? AND generation=?",
        retry.kind,
        retry.workId,
        generation
      )
      .toArray();

    const attempts = (previous?.attempts ?? 0) + 1;
    const exhausted = attempts > 2;

    const next =
      at +
      Math.max(
        retry.retryAfterMs ?? CONTINUATION_DELAY,
        exhausted ? HARVEST_INTERVAL : CONTINUATION_DELAY
      );

    storage.sql.exec(
      `INSERT INTO harvest_retries VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, work_id) DO UPDATE SET generation=excluded.generation, attempts=excluded.attempts,
    next_due=excluded.next_due, exhausted=excluded.exhausted, reason=excluded.reason`,
      retry.kind,
      retry.workId,
      retry.channelId,
      generation,
      attempts,
      next,
      Number(exhausted),
      retry.reason
    );
    storage.sql.exec(
      "UPDATE fetch_progress SET failure=? WHERE stream_id=?",
      retry.reason,
      retry.channelId
    );

    if (retry.global) {
      storage.sql.exec(
        "UPDATE harvest_schedule SET global_pause=MAX(global_pause, ?) WHERE id=1",
        at + (retry.retryAfterMs ?? CONTINUATION_DELAY)
      );
    }
  });

export const clearRetry = (
  sql: SqlStorage,
  kind: HarvestRetry["kind"],
  workId: string,
  generation?: number
): void => {
  const current = sql
    .exec<{ generation: number }>(
      "SELECT generation FROM harvest_cycle WHERE id=1"
    )
    .one().generation;

  if (generation !== undefined && generation !== current) {
    return;
  }

  const [previous] = sql
    .exec<{ channel_id: string }>(
      "SELECT channel_id FROM harvest_retries WHERE kind=? AND work_id=?",
      kind,
      workId
    )
    .toArray();

  sql.exec(
    "DELETE FROM harvest_retries WHERE kind=? AND work_id=?",
    kind,
    workId
  );

  if (previous !== undefined) {
    sql.exec(
      `UPDATE fetch_progress SET failure=NULL WHERE parent_channel_id=?
      AND NOT EXISTS (SELECT 1 FROM harvest_retries WHERE channel_id=fetch_progress.parent_channel_id)`,
      previous.channel_id
    );
  }
};

export const nextWork = (
  sql: SqlStorage,
  channelIds: readonly string[],
  generation: number,
  at: number
) => {
  const placeholders = channelIds.map(() => "?").join(",");

  const row = sql
    .exec<{ next: number | null; exhausted_at: number | null }>(
      `WITH pending AS (SELECT 'processing' AS kind, message_id AS work_id FROM processing JOIN messages ON message_id=messages.id
      WHERE completed=0 AND deleted_at IS NULL AND parent_channel_id IN (${placeholders}))
    SELECT MIN(CASE WHEN COALESCE(r.exhausted, 0)=0 THEN COALESCE(r.next_due, ?) END) AS next,
      MIN(CASE WHEN r.exhausted=1 THEN r.next_due END) AS exhausted_at
    FROM pending p LEFT JOIN harvest_retries r ON r.kind=p.kind AND r.work_id=p.work_id AND r.generation=?`,
      ...channelIds,
      at,
      generation
    )
    .one();

  let next = row.next ?? Infinity;
  let exhaustedAt = row.exhausted_at ?? Infinity;

  for (const work of acquisitionWork(sql, channelIds, generation)) {
    const [retry] = sql
      .exec<{ next_due: number; exhausted: number }>(
        "SELECT next_due,exhausted FROM harvest_retries WHERE kind='acquisition' AND work_id=? AND generation=?",
        work.work_id,
        generation
      )
      .toArray();

    if (retry?.exhausted === 1) {
      exhaustedAt = Math.min(exhaustedAt, retry.next_due);
    } else {
      next = Math.min(next, retry?.next_due ?? at);
    }
  }

  return { next, exhaustedAt };
};
