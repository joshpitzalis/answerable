import type { Project } from "../../domain";
import {
  CONTINUATION_DELAY,
  HARVEST_INTERVAL,
  MANUAL_COOLDOWN,
} from "../../domain/schedule.values";
import type { HarvestSchedule } from "../../domain/schedule.values";
import { beginCycle, readCycle } from "./cycle";
import { activateProject, readSavedProject } from "./progress";
import { nextWork } from "./retries";

export const readSchedule = (sql: SqlStorage): HarvestSchedule => {
  const row = sql
    .exec<{
      project_id: string | null;
      mode: "live" | "fixture" | null;
      next_due: number | null;
      next_alarm: number | null;
      last_manual: number | null;
      global_pause: number;
      retry_cycle_at: number;
      run_generation: number | null;
    }>("SELECT * FROM harvest_schedule WHERE id=1")
    .one();

  return {
    projectId: row.project_id,
    mode: row.mode,
    nextDue: row.next_due,
    nextAlarm: row.next_alarm,
    lastManual: row.last_manual,
    globalPause: row.global_pause,
    retryCycleAt: row.retry_cycle_at,
    runGeneration: row.run_generation,
  };
};

export const requestScheduledHarvest = (
  storage: DurableObjectStorage,
  project: Project,
  mode: "live" | "fixture",
  manual: boolean,
  at: number
): void =>
  storage.transactionSync(() => {
    const schedule = readSchedule(storage.sql);

    if (schedule.projectId === null) {
      activateProject(storage, project, at);
      beginCycle(storage.sql);
      storage.sql.exec(
        "UPDATE harvest_schedule SET project_id=?, mode=?, next_due=?, last_manual=? WHERE id=1",
        project.id,
        mode,
        at,
        at
      );

      return;
    }

    if (schedule.projectId !== project.id || schedule.mode !== mode) {
      throw new Error("Project schedule identity cannot change");
    }

    if (
      !manual ||
      readCycle(storage.sql).active === 1 ||
      (schedule.nextDue !== null &&
        schedule.lastManual !== null &&
        schedule.nextDue <= schedule.lastManual)
    ) {
      return;
    }

    const eligible = Math.max(
      at,
      (schedule.lastManual ?? 0) + MANUAL_COOLDOWN,
      schedule.globalPause,
      schedule.retryCycleAt
    );

    storage.sql.exec(
      "UPDATE harvest_schedule SET next_due=MIN(next_due, ?), last_manual=? WHERE id=1",
      eligible,
      eligible
    );
  });

export const completeScheduledBatch = (
  sql: SqlStorage,
  project: Project,
  at: number
): number => {
  const saved = readSavedProject(sql, project, at);
  const schedule = readSchedule(sql);

  const work = nextWork(
    sql,
    project.channels.map((channel) => channel.id),
    readCycle(sql).generation,
    at
  );

  const exhausted = work.next === Infinity && work.exhaustedAt !== Infinity;

  const due =
    saved.harvest.status === "current"
      ? (saved.harvest.lastCompleteSuccess ?? at) + HARVEST_INTERVAL
      : Math.max(
          at + CONTINUATION_DELAY,
          exhausted ? work.exhaustedAt : work.next
        );

  const next = Math.max(
    Number.isFinite(due) ? due : at + HARVEST_INTERVAL,
    schedule.globalPause
  );

  sql.exec(
    "UPDATE harvest_schedule SET next_due=?, retry_cycle_at=?, run_generation=NULL WHERE id=1",
    next,
    exhausted ? next : 0
  );

  return next;
};

export const startScheduledBatch = (
  storage: DurableObjectStorage,
  project: Project,
  at: number
): void =>
  storage.transactionSync(() => {
    const schedule = readSchedule(storage.sql);

    if (schedule.retryCycleAt > 0 && schedule.retryCycleAt <= at) {
      storage.sql.exec("UPDATE harvest_cycle SET active=0 WHERE id=1");
      storage.sql.exec(
        "UPDATE harvest_schedule SET retry_cycle_at=0 WHERE id=1"
      );
    }

    activateProject(storage, project, at);
    beginCycle(storage.sql);
    storage.sql.exec(
      "UPDATE harvest_schedule SET run_generation=? WHERE id=1",
      readCycle(storage.sql).generation
    );
  });
