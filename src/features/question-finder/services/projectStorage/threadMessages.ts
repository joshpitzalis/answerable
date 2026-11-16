import type { SourceMessage } from "../../domain/harvest.values";
import { compareSnowflakes } from "../../domain/harvest.values";
import { advanceMessagePage } from "../../domain/pagination.rules";
import type { DiscordThread } from "../../domain/thread.values";
import { ingestMessage } from "./content";
import { readCycle } from "./cycle";
import { finishDiscovery } from "./forumState";
import { readProgress } from "./progress";
import { invalidateThreadContext } from "./threadContext";

export const saveThreadMessages = (
  storage: DurableObjectStorage,
  thread: DiscordThread,
  generation: number,
  messages: readonly SourceMessage[],
  policyRevision: string,
  at: number
): boolean =>
  storage.transactionSync(() => {
    const { sql } = storage;

    if (readCycle(sql).generation !== generation) {
      return false;
    }
    const progress = readProgress(sql, thread.id);
    const next = advanceMessagePage(progress, messages, at, generation, 50);

    if (next === null) {
      return false;
    }
    for (const message of messages) {
      if (
        message.channelId !== thread.id ||
        message.parentChannelId !== thread.parentChannelId ||
        message.threadId !== thread.id
      ) {
        throw new Error("Thread page belongs to another stream");
      }
      if (
        progress.upperBoundary !== null &&
        compareSnowflakes(message.id, progress.upperBoundary) > 0
      ) {
        continue;
      }
      // Text-thread starter system messages must not replace the original parent message.
      if (
        message.id === thread.starterId &&
        sql.exec("SELECT id FROM messages WHERE id=?", message.id).toArray()
          .length > 0
      ) {
        continue;
      }
      ingestMessage(sql, message, {
        messages,
        progress: next,
        observedAt: at,
        policyRevision,
      });
    }

    sql.exec(
      `UPDATE fetch_progress SET completed_boundary=?,upper_boundary=?,before_id=?,seeded=?,last_completed_at=?,failure=NULL,generation=? WHERE stream_id=?`,
      next.completedBoundary,
      next.upperBoundary,
      next.before,
      Number(next.seeded),
      next.lastCompletedAt,
      next.generation ?? 0,
      thread.id
    );

    if (next.generation === generation && next.before === null) {
      sql.exec(
        "UPDATE discord_threads SET collect_pending=0,collected_generation=? WHERE id=?",
        generation,
        thread.id
      );
    }

    invalidateThreadContext(sql, thread.starterId);
    finishDiscovery(sql, thread.parentChannelId, generation, at);

    return true;
  });
