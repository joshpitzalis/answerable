import { activationBoundary } from "../../domain/values/harvest.values";
import type { DiscordThread } from "../../domain/values/thread.values";
import { invalidateThreadContext } from "./threadContext";

// oxlint-disable-next-line typescript/consistent-type-definitions -- SQLite rows require an implicit index signature.
type ScanRow = {
  generation: number;
  active_done: number;
  archive_done: number;
  before_timestamp: string | null;
  archive_floor: string;
  scan_upper: string;
};

// oxlint-disable-next-line typescript/consistent-type-definitions -- SQLite rows require an implicit index signature.
export type ThreadRow = {
  id: string;
  parent_channel_id: string;
  title: string;
  starter_id: string;
  archived: number;
  archive_timestamp: string;
  starter_pending: number;
  is_post: number;
};

export const scan = (sql: SqlStorage, channelId: string) => {
  const [row] = sql
    .exec<ScanRow>("SELECT * FROM forum_scans WHERE channel_id=?", channelId)
    .toArray();

  return row;
};

export const fromThread = (row: ThreadRow): DiscordThread => ({
  id: row.id,
  parentChannelId: row.parent_channel_id,
  title: row.title,
  starterId: row.starter_id,
  archived: row.archived === 1,
  archiveTimestamp: row.archive_timestamp,
  isPost: row.is_post === 1,
});

export const saveThread = (
  sql: SqlStorage,
  thread: DiscordThread,
  at: number
): void => {
  sql.exec(
    `INSERT INTO discord_threads (id,parent_channel_id,title,starter_id,archived,archive_timestamp,observed_at,is_post) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,
    collect_pending=CASE WHEN discord_threads.archived != excluded.archived THEN 1 ELSE discord_threads.collect_pending END, archived=excluded.archived,
    archive_timestamp=excluded.archive_timestamp, observed_at=excluded.observed_at`,
    thread.id,
    thread.parentChannelId,
    thread.title,
    thread.starterId,
    Number(thread.archived),
    thread.archiveTimestamp,
    at,
    Number(thread.isPost !== false)
  );
  sql.exec(
    "UPDATE discord_threads SET starter_pending=0 WHERE id=? AND EXISTS (SELECT 1 FROM messages WHERE id=?)",
    thread.id,
    thread.starterId
  );

  if (thread.isPost === false) {
    sql.exec(
      "UPDATE messages SET thread_id=? WHERE id=? AND channel_id=?",
      thread.id,
      thread.starterId,
      thread.parentChannelId
    );
  }

  sql.exec(
    "INSERT OR IGNORE INTO fetch_progress (stream_id,parent_channel_id,completed_boundary,seeded) VALUES (?,?,'0',1)",
    thread.id,
    thread.parentChannelId
  );
  invalidateThreadContext(sql, thread.starterId);
};

export const finishDiscovery = (
  sql: SqlStorage,
  channelId: string,
  generation: number,
  at: number
): void => {
  const current = scan(sql, channelId);

  const pending = sql
    .exec(
      "SELECT id FROM discord_threads WHERE parent_channel_id=? AND (starter_pending=1 OR collect_pending=1 OR (archived=0 AND collected_generation<?)) LIMIT 1",
      channelId,
      generation
    )
    .toArray();

  sql.exec(
    "UPDATE fetch_progress SET failure=NULL WHERE stream_id=?",
    channelId
  );

  if (current?.archive_done !== 1 || pending.length > 0) {
    return;
  }

  sql.exec(
    `UPDATE fetch_progress SET seeded=1,generation=?,before_id=NULL,upper_boundary=NULL,
    completed_boundary=COALESCE(completed_boundary,?),last_completed_at=? WHERE stream_id=?`,
    generation,
    activationBoundary(at),
    at,
    channelId
  );
};

export const discoveryComplete = (
  sql: SqlStorage,
  channelId: string,
  generation: number
): boolean => {
  const current = scan(sql, channelId);

  if (current?.generation !== generation || current.archive_done !== 1) {
    return false;
  }

  return (
    sql
      .exec(
        "SELECT id FROM discord_threads WHERE parent_channel_id=? AND (starter_pending=1 OR collect_pending=1 OR (archived=0 AND collected_generation<?)) LIMIT 1",
        channelId,
        generation
      )
      .toArray().length === 0
  );
};
