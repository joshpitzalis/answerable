import {
  activationBoundary,
  compareSnowflakes,
} from "../../domain/harvest.values";
import type { SourceMessage } from "../../domain/harvest.values";
import { advanceArchivePage } from "../../domain/thread.rules";
import { compareArchiveTimes } from "../../domain/thread.values";
import type { ForumRequest, ThreadPage } from "../../domain/thread.values";
import { ingestMessage } from "./content";
import { readCycle } from "./cycle";
import { finishDiscovery, fromThread, saveThread, scan } from "./forumState";
import type { ThreadRow } from "./forumState";
import { readProgress } from "./progress";
import { clearRetry } from "./retries";
import { invalidateThreadContext } from "./threadContext";

export const nextForumRequest = (
  sql: SqlStorage,
  channelId: string,
  generation: number,
  at: number
): ForumRequest | undefined => {
  const previous = scan(sql, channelId);

  if (
    previous === undefined ||
    previous.generation !== generation ||
    previous.active_done === 0
  ) {
    return readProgress(sql, channelId).generation === generation
      ? { kind: "active" }
      : undefined;
  }

  if (previous.archive_done === 0) {
    return { kind: "archive", before: previous.before_timestamp };
  }

  const [pending] = sql
    .exec<ThreadRow>(
      `SELECT * FROM discord_threads WHERE parent_channel_id=?
      AND (starter_pending=1 OR collect_pending=1 OR (archived=0 AND collected_generation<?))
      AND NOT EXISTS (SELECT 1 FROM harvest_retries WHERE kind='acquisition' AND work_id=discord_threads.id AND generation=? AND (exhausted=1 OR next_due>?))
      ORDER BY last_selected,length(id),id LIMIT 1`,
      channelId,
      generation,
      generation,
      at
    )
    .toArray();

  if (pending === undefined) {
    return undefined;
  }

  sql.exec(
    "UPDATE discord_threads SET last_selected=(SELECT COALESCE(MAX(last_selected),0)+1 FROM discord_threads) WHERE id=?",
    pending.id
  );

  return pending.starter_pending === 1
    ? { kind: "starter", thread: fromThread(pending) }
    : {
        kind: "messages",
        thread: fromThread(pending),
        before: readProgress(sql, pending.id).before,
      };
};

export const saveThreadPage = (
  storage: DurableObjectStorage,
  channelId: string,
  generation: number,
  page: ThreadPage,
  at: number
): boolean =>
  storage.transactionSync(() => {
    const { sql } = storage;

    if (readCycle(sql).generation !== generation) {
      return false;
    }

    const previous = scan(sql, channelId);

    const { activated_at } = sql
      .exec<{ activated_at: number }>(
        "SELECT activated_at FROM harvest_state WHERE id=1"
      )
      .one();

    if (page.scope === "active") {
      const unique = [
        ...new Map(page.threads.map((thread) => [thread.id, thread])).values(),
      ];

      const selected =
        previous === undefined && page.isForum !== false
          ? unique
              .toSorted((a, b) => compareSnowflakes(b.id, a.id))
              .slice(0, 50)
          : unique.filter(
              (thread) =>
                compareSnowflakes(
                  thread.id,
                  activationBoundary(activated_at)
                ) >= 0 ||
                sql
                  .exec("SELECT id FROM discord_threads WHERE id=?", thread.id)
                  .toArray().length > 0 ||
                (page.isForum === false &&
                  sql
                    .exec(
                      "SELECT id FROM messages WHERE id=? AND parent_channel_id=?",
                      thread.starterId,
                      channelId
                    )
                    .toArray().length > 0)
            );

      for (const thread of selected) {
        saveThread(sql, thread, at);
      }

      sql.exec(
        `INSERT INTO forum_scans VALUES (?,?,1,0,NULL,?,?)
      ON CONFLICT(channel_id) DO UPDATE SET generation=excluded.generation,active_done=1,archive_done=0,before_timestamp=NULL,scan_upper=excluded.scan_upper`,
        channelId,
        generation,
        previous?.archive_floor ?? new Date(activated_at).toISOString(),
        new Date(at).toISOString()
      );
      finishDiscovery(sql, channelId, generation, at);
      clearRetry(sql, "acquisition", channelId, generation);

      return true;
    }

    if (previous === undefined || previous.generation !== generation) {
      throw new Error("Forum discovery has no active range");
    }

    const next = advanceArchivePage(
      page.threads.map((thread) => thread.archiveTimestamp),
      page.hasMore,
      {
        before: previous.before_timestamp,
        floor: previous.archive_floor,
        upper: previous.scan_upper,
      }
    );

    for (const thread of page.threads) {
      if (
        compareArchiveTimes(thread.archiveTimestamp, previous.archive_floor) >=
          0 &&
        compareArchiveTimes(thread.archiveTimestamp, previous.scan_upper) <= 0
      ) {
        saveThread(sql, thread, at);
      }
    }

    if (next === null) {
      return false;
    }

    sql.exec(
      "UPDATE forum_scans SET archive_done=?,before_timestamp=?,archive_floor=? WHERE channel_id=?",
      Number(next.done),
      next.before,
      next.floor,
      channelId
    );
    finishDiscovery(sql, channelId, generation, at);
    clearRetry(sql, "acquisition", channelId, generation);

    return true;
  });

export const saveForumStarter = (
  storage: DurableObjectStorage,
  channelId: string,
  generation: number,
  message: SourceMessage,
  policyRevision: string,
  at: number
): void =>
  storage.transactionSync(() => {
    const { sql } = storage;

    if (readCycle(sql).generation !== generation) {
      return;
    }

    const row = sql
      .exec<ThreadRow>(
        "SELECT * FROM discord_threads WHERE starter_id=? AND parent_channel_id=?",
        message.id,
        channelId
      )
      .one();

    if (
      message.channelId !==
        (row.is_post === 1 ? row.id : row.parent_channel_id) ||
      message.threadId !== row.id
    ) {
      throw new Error("Forum starter belongs to another thread");
    }

    ingestMessage(sql, message, {
      messages: [message],
      observedAt: at,
      policyRevision,
      progress: readProgress(sql, channelId),
    });
    invalidateThreadContext(sql, message.id);
    sql.exec("UPDATE discord_threads SET starter_pending=0 WHERE id=?", row.id);
    finishDiscovery(sql, channelId, generation, at);
    clearRetry(sql, "acquisition", row.id, generation);
  });
