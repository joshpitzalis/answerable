import { activationBoundary } from "../../domain/harvest.values";
import type { DiscordThread } from "../../domain/thread.values";
import { invalidateProcessingContext } from "./processing";

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
});

export const saveThread = (
  sql: SqlStorage,
  thread: DiscordThread,
  at: number
): void => {
  sql.exec(
    `INSERT INTO discord_threads (id,parent_channel_id,title,starter_id,archived,archive_timestamp,observed_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, archived=excluded.archived,
    archive_timestamp=excluded.archive_timestamp, observed_at=excluded.observed_at`,
    thread.id,
    thread.parentChannelId,
    thread.title,
    thread.starterId,
    Number(thread.archived),
    thread.archiveTimestamp,
    at
  );
  invalidateProcessingContext(
    sql,
    thread.starterId,
    JSON.stringify([thread.title])
  );
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
      "SELECT id FROM discord_threads WHERE parent_channel_id=? AND starter_pending=1 LIMIT 1",
      channelId
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
