import type { Project } from "../../domain";

const channelIds = (project: Project) =>
  JSON.stringify(project.channels.map((channel) => channel.id).toSorted());

export const readConfiguration = (sql: SqlStorage) =>
  sql
    .exec<{
      channel_ids: string | null;
      owner_name: string | null;
      suspended: number;
    }>("SELECT * FROM harvest_configuration WHERE id=1")
    .one();

export const configurationMatches = (
  sql: SqlStorage,
  project: Project
): boolean => {
  const current = readConfiguration(sql);

  return (
    current.suspended === 0 &&
    (current.channel_ids === null ||
      (current.channel_ids === channelIds(project) &&
        current.owner_name === project.ownerName))
  );
};

const identityChanged = (sql: SqlStorage, project: Project | undefined) => {
  const state = sql
    .exec<{ project_id: string | null; server_id: string | null }>(
      "SELECT project_id,server_id FROM harvest_state WHERE id=1"
    )
    .one();

  return (
    project !== undefined &&
    state.project_id !== null &&
    (state.project_id !== project.id || state.server_id !== project.serverId)
  );
};

export const reconcileConfiguration = (
  storage: DurableObjectStorage,
  project: Project | undefined,
  mode: "live" | "fixture",
  enabled: boolean,
  at: number
): boolean =>
  storage.transactionSync(() => {
    const { sql } = storage;
    const current = readConfiguration(sql);

    const schedule = sql
      .exec<{ project_id: string | null; mode: string | null }>(
        "SELECT project_id,mode FROM harvest_schedule WHERE id=1"
      )
      .one();

    const mismatch = identityChanged(sql, project);

    const suspended =
      !enabled ||
      project === undefined ||
      mismatch ||
      (schedule.mode !== null && schedule.mode !== mode);

    const sources =
      project === undefined || mismatch
        ? current.channel_ids
        : channelIds(project);

    const owner =
      project === undefined || mismatch
        ? current.owner_name
        : project.ownerName;

    const changed =
      current.channel_ids !== null &&
      (sources !== current.channel_ids || owner !== current.owner_name);

    if (changed || suspended !== (current.suspended === 1)) {
      // In-flight pages and judgements carry the old generation; retained cursors stay usable.
      sql.exec(
        "UPDATE harvest_cycle SET generation=generation+1, active=? WHERE id=1",
        suspended ? 0 : 1
      );
      sql.exec(
        "UPDATE harvest_schedule SET run_generation=NULL, retry_cycle_at=0 WHERE id=1"
      );

      if (!suspended && schedule.project_id !== null) {
        sql.exec(
          "UPDATE harvest_schedule SET next_due=MAX(?,global_pause) WHERE id=1",
          at
        );
      }
    }

    sql.exec(
      "UPDATE harvest_configuration SET channel_ids=?,owner_name=?,suspended=? WHERE id=1",
      sources,
      owner,
      suspended ? 1 : 0
    );

    if (sources !== null) {
      sql.exec(
        "DELETE FROM harvest_retries WHERE channel_id NOT IN (SELECT value FROM json_each(?))",
        sources
      );
    }

    if (suspended) {
      sql.exec(
        "UPDATE harvest_schedule SET next_due=NULL,next_alarm=NULL,run_generation=NULL WHERE id=1"
      );
    }

    return suspended;
  });
