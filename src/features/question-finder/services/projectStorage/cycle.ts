import type { Project } from "../../domain";
import type { HarvestTurn } from "../../domain/harvest.values";
import { acquisitionWork } from "./acquisitionWork";
import { workEligible } from "./retries";

// oxlint-disable-next-line typescript/consistent-type-definitions -- SQLite rows require an implicit index signature.
type CycleRow = {
  generation: number;
  active: number;
  acquire_turn: number;
  process_turn: number;
};

export const readCycle = (sql: SqlStorage) =>
  sql.exec<CycleRow>("SELECT * FROM harvest_cycle WHERE id=1").one();

export const beginCycle = (sql: SqlStorage): void => {
  sql.exec(
    "UPDATE harvest_cycle SET generation=generation+1, active=1 WHERE id=1 AND active=0"
  );
};

export const claimAcquisition = (
  storage: DurableObjectStorage,
  project: Project,
  at = Date.now()
): HarvestTurn | null =>
  storage.transactionSync(() => {
    const cycle = readCycle(storage.sql);

    if (cycle.active === 0) {
      return null;
    }

    for (let offset = 0; offset < project.channels.length; offset += 1) {
      const index = (cycle.acquire_turn + offset) % project.channels.length;
      const channel = project.channels[index];

      if (
        !acquisitionWork(storage.sql, [channel.id], cycle.generation).some(
          (work) =>
            workEligible(
              storage.sql,
              "acquisition",
              work.work_id,
              cycle.generation,
              at
            )
        )
      ) {
        continue;
      }

      // Claim the next turn before IO, so an interrupted busy Channel cannot starve its siblings.
      storage.sql.exec(
        "UPDATE harvest_cycle SET acquire_turn=? WHERE id=1",
        (index + 1) % project.channels.length
      );

      return { generation: cycle.generation, channelId: channel.id };
    }

    return null;
  });

export const claimProcessing = (
  storage: DurableObjectStorage,
  project: Project,
  at = Date.now()
): string | null =>
  storage.transactionSync(() => {
    const cycle = readCycle(storage.sql);

    for (let offset = 0; offset < project.channels.length; offset += 1) {
      const index = (cycle.process_turn + offset) % project.channels.length;
      const channel = project.channels[index];

      const pending = storage.sql
        .exec<{ found: number }>(
          `SELECT 1 AS found FROM processing JOIN messages ON messages.id=message_id
        WHERE parent_channel_id=? AND completed=0 AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM harvest_retries WHERE kind='processing' AND work_id=message_id AND generation=? AND (exhausted=1 OR next_due>?)) LIMIT 1`,
          channel.id,
          cycle.generation,
          at
        )
        .toArray();

      if (pending.length === 0) {
        continue;
      }

      storage.sql.exec(
        "UPDATE fetch_progress SET failure=NULL WHERE stream_id=? AND failure='Saved messages could not be judged'",
        channel.id
      );
      storage.sql.exec(
        "UPDATE harvest_cycle SET process_turn=? WHERE id=1",
        (index + 1) % project.channels.length
      );

      return channel.id;
    }

    return null;
  });
