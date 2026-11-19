import type { Project } from "../../domain";
import { RECOVERY_DELAY } from "../../domain/values/schedule.values";
import { readConfiguration, reconcileConfiguration } from "./configuration";
import { readSchedule } from "./schedule";

export const cancelProjectWake = async (
  storage: DurableObjectStorage
): Promise<void> => {
  await storage.deleteAlarm();
  storage.sql.exec("UPDATE harvest_schedule SET next_alarm=NULL WHERE id=1");
};

export const setProjectWake = async (
  storage: DurableObjectStorage,
  at: number
): Promise<void> => {
  if (readConfiguration(storage.sql).suspended === 1) {
    return;
  }

  await storage.setAlarm(at);

  // A configuration request may suspend the Project while setAlarm yields.
  if (readConfiguration(storage.sql).suspended === 1) {
    await cancelProjectWake(storage);

    return;
  }

  storage.sql.exec("UPDATE harvest_schedule SET next_alarm=? WHERE id=1", at);
};

export const reconcileProjectWake = async (
  storage: DurableObjectStorage,
  project: Project | undefined,
  mode: "live" | "fixture",
  enabled: boolean,
  at: number
): Promise<boolean> => {
  const before = readSchedule(storage.sql);
  const previous = readConfiguration(storage.sql);

  if (
    enabled &&
    project !== undefined &&
    before.projectId === project.id &&
    before.mode === mode &&
    previous.suspended === 1
  ) {
    // Resume must have a recovery wake before its durable state becomes runnable.
    await storage.setAlarm(at + RECOVERY_DELAY);
  }

  const suspended = reconcileConfiguration(storage, project, mode, enabled, at);

  if (suspended) {
    await cancelProjectWake(storage);

    return true;
  }

  const after = readSchedule(storage.sql);

  if (
    after.nextDue !== null &&
    (after.nextDue !== before.nextDue || previous.suspended === 1)
  ) {
    await setProjectWake(storage, after.nextDue);
  }

  return false;
};
