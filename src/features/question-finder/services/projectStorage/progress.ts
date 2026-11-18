import { contributorStats } from "../../domain";
import type { Contributor, Project } from "../../domain";
import type {
  FetchProgress,
  HarvestStatus,
  StoredQuestionsReply,
} from "../../domain/harvest.values";
import { configurationMatches, readConfiguration } from "./configuration";
import { readMessages } from "./content";
import { readCycle } from "./cycle";
import { discoveryComplete } from "./forumState";
import { countPendingCandidates } from "./processing";
import { readQuestions } from "./questions";
import { reconciliationPending } from "./reconciliationWork";

// oxlint-disable-next-line typescript/consistent-type-definitions -- SQLite rows require an implicit index signature.
type StateRow = {
  project_id: string | null;
  server_id: string | null;
  activated_at: number | null;
  last_attempt: number | null;
  last_complete_success: number | null;
};

// oxlint-disable-next-line typescript/consistent-type-definitions -- SQLite rows require an implicit index signature.
type ProgressRow = {
  generation: number;
  stream_id: string;
  parent_channel_id: string;
  completed_boundary: string | null;
  upper_boundary: string | null;
  before_id: string | null;
  seeded: number;
  last_completed_at: number | null;
  failure: string | null;
};

export const readProgress = (sql: SqlStorage, id: string): FetchProgress => {
  const row = sql
    .exec<ProgressRow>("SELECT * FROM fetch_progress WHERE stream_id = ?", id)
    .one();

  return {
    generation: row.generation,
    streamId: row.stream_id,
    parentChannelId: row.parent_channel_id,
    completedBoundary: row.completed_boundary,
    upperBoundary: row.upper_boundary,
    before: row.before_id,
    seeded: row.seeded === 1,
    lastCompletedAt: row.last_completed_at,
    failure: row.failure,
  };
};

export const activateProject = (
  storage: DurableObjectStorage,
  project: Project,
  at: number
): void =>
  storage.transactionSync(() => {
    const previous = storage.sql
      .exec<StateRow>("SELECT * FROM harvest_state WHERE id = 1")
      .one();

    if (
      previous.project_id !== null &&
      (previous.project_id !== project.id ||
        previous.server_id !== project.serverId)
    ) {
      throw new Error("Project storage identity cannot move to another server");
    }

    storage.sql.exec(
      `UPDATE harvest_state SET project_id=?, server_id=?, activated_at=COALESCE(activated_at, ?), last_attempt=? WHERE id=1`,
      project.id,
      project.serverId,
      at,
      at
    );

    for (const channel of project.channels) {
      storage.sql.exec(
        "INSERT OR IGNORE INTO fetch_progress (stream_id, parent_channel_id) VALUES (?, ?)",
        channel.id,
        channel.id
      );
    }
  });

export const recordFailure = (
  sql: SqlStorage,
  streamId: string,
  reason: string
): void => {
  sql.exec(
    "UPDATE fetch_progress SET failure=? WHERE stream_id=?",
    reason,
    streamId
  );
};

const contributors = (
  sql: SqlStorage,
  channelIds: readonly string[]
): Contributor[] => {
  const byAuthor = new Map<string, Contributor>();

  for (const message of readMessages(sql)) {
    if (
      !channelIds.includes(message.parentChannelId) ||
      message.authorIsBot ||
      message.authorIsWebhook ||
      message.deletedAt !== null
    ) {
      continue;
    }

    const previous = byAuthor.get(message.authorId);
    byAuthor.set(message.authorId, {
      name: message.authorName,
      avatarUrl: message.authorAvatarUrl,
      responses: (previous?.responses ?? 0) + 1,
    });
  }

  return [...byAuthor.values()];
};

const statusOf = (
  activatedAt: number | null,
  failed: boolean,
  incomplete: boolean
): HarvestStatus["status"] => {
  if (activatedAt === null) {
    return "new";
  }

  if (failed) {
    return "partial";
  }

  return incomplete ? "working" : "current";
};

export const readSavedProject = (
  sql: SqlStorage,
  project: Project,
  at = Date.now()
): StoredQuestionsReply => {
  const state = sql
    .exec<StateRow>("SELECT * FROM harvest_state WHERE id=1")
    .one();

  if (
    state.project_id !== null &&
    (state.project_id !== project.id || state.server_id !== project.serverId)
  ) {
    throw new Error("Project storage identity cannot move to another server");
  }

  const ids = project.channels.map((channel) => channel.id);

  const progress = sql
    .exec<ProgressRow>("SELECT * FROM fetch_progress")
    .toArray()
    .filter((row) => ids.includes(row.parent_channel_id));

  const failures = [
    ...progress,
    ...sql
      .exec<{ parent_channel_id: string; failure: string }>(
        "SELECT channel_id AS parent_channel_id, reason AS failure FROM harvest_retries"
      )
      .toArray(),
  ];

  const failedChannels = failures
    .flatMap((row) => {
      const channel = project.channels.find(
        (item) => item.id === row.parent_channel_id
      );

      return channel === undefined || row.failure === null
        ? []
        : [{ name: channel.name, reason: row.failure }];
    })
    .filter(
      (failure, index, all) =>
        all.findIndex(
          (item) => item.name === failure.name && item.reason === failure.reason
        ) === index
    );

  const pendingProcessing = countPendingCandidates(sql, ids);
  const cycle = readCycle(sql);

  const incomplete =
    reconciliationPending(sql, ids) ||
    (cycle.active === 1 &&
      ids.some((id) => !discoveryComplete(sql, id, cycle.generation))) ||
    progress.length < ids.length ||
    progress
      .filter((row) => row.stream_id === row.parent_channel_id)
      .some(
        (row) =>
          row.seeded === 0 ||
          row.before_id !== null ||
          (cycle.active === 1 && row.generation < cycle.generation)
      );

  const status = statusOf(
    state.activated_at,
    failedChannels.length > 0,
    incomplete || pendingProcessing > 0
  );

  const schedule = sql
    .exec<{
      next_due: number | null;
      last_manual: number | null;
      run_generation: number | null;
    }>(
      "SELECT next_due,last_manual,run_generation FROM harvest_schedule WHERE id=1"
    )
    .one();

  const waiting =
    schedule.run_generation === null &&
    schedule.next_due !== null &&
    schedule.next_due > at &&
    (status === "working" ||
      (status === "current" && schedule.next_due === schedule.last_manual));

  const runningStatus = waiting ? "waiting" : status;

  return {
    questions: readQuestions(sql).flatMap((row) => {
      const channel = project.channels.find(
        (item) => item.id === row.channel.id
      );

      return channel === undefined
        ? []
        : [{ ...row, project: project.slug, channel }];
    }),
    contributorStats: contributorStats(contributors(sql, ids)),
    failedChannels,
    harvest: {
      status:
        readConfiguration(sql).suspended === 1 ? "suspended" : runningStatus,
      activatedAt: state.activated_at,
      lastAttempt: state.last_attempt,
      lastCompleteSuccess: state.last_complete_success,
      initialCoverage: "latest-50",
      pendingProcessing,
      nextEligibleAt: schedule.next_due,
    },
  };
};

export const finishAttempt = (
  sql: SqlStorage,
  project: Project,
  at: number
): void => {
  if (
    configurationMatches(sql, project) &&
    readSavedProject(sql, project, at).harvest.status === "current"
  ) {
    sql.exec("UPDATE harvest_state SET last_complete_success=? WHERE id=1", at);
    sql.exec("UPDATE harvest_cycle SET active=0 WHERE id=1");
  }
};
