import { Clock, Context, Effect, Layer, Schema } from "effect";

import type { Project, QuestionsRow } from "../../domain";
import type {
  FetchProgress,
  HarvestTurn,
  IngestionCounts,
  PageIngestion,
  ProcessingCandidate,
  StoredMessage,
  StoredQuestionsReply,
  SourceMessage,
} from "../../domain/harvest.values";
import type {
  HarvestRetry,
  HarvestSchedule,
} from "../../domain/schedule.values";
import type {
  DiscordThread,
  ForumRequest,
  ThreadPage,
} from "../../domain/thread.values";
import { ingestPage, readMessages } from "./content";
import { beginCycle, claimAcquisition, claimProcessing } from "./cycle";
import { nextForumRequest, saveForumStarter, saveThreadPage } from "./forums";
import {
  completeProcessing,
  invalidateProcessingContext,
  pendingCandidates,
  reprocessCandidates,
} from "./processing";
import {
  activateProject,
  finishAttempt,
  readProgress,
  readSavedProject,
  recordFailure,
} from "./progress";
import { readQuestions, saveQuestions } from "./questions";
import { recordRetry } from "./retries";
import {
  completeScheduledBatch,
  readSchedule,
  requestScheduledHarvest,
  startScheduledBatch,
} from "./schedule";
import { saveThreadMessages } from "./threadMessages";

export { migrateProjectStorage, projectMigrations } from "./migrations";

export class ProjectStorageError extends Schema.TaggedError<ProjectStorageError>()(
  "ProjectStorageError",
  { operation: Schema.String, cause: Schema.Defect() }
) {}

const attempt = <A>(operation: string, body: () => A) =>
  Effect.try({
    try: body,
    catch: (cause) => new ProjectStorageError({ operation, cause }),
  });

export class ProjectStorage extends Context.Service<
  ProjectStorage,
  {
    readonly saveThreadMessages: (
      thread: DiscordThread,
      generation: number,
      messages: readonly SourceMessage[],
      policyRevision: string,
      at: number
    ) => Effect.Effect<boolean, ProjectStorageError>;
    readonly schedule: Effect.Effect<HarvestSchedule, ProjectStorageError>;
    readonly requestScheduled: (
      project: Project,
      mode: "live" | "fixture",
      manual: boolean,
      at: number
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly finishScheduled: (
      project: Project,
      at: number
    ) => Effect.Effect<number, ProjectStorageError>;
    readonly startScheduled: (
      project: Project,
      at: number
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly retry: (
      failure: HarvestRetry
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly forumRequest: (
      channelId: string,
      generation: number
    ) => Effect.Effect<ForumRequest | undefined, ProjectStorageError>;
    readonly saveThreadPage: (
      channelId: string,
      generation: number,
      page: ThreadPage,
      at: number
    ) => Effect.Effect<boolean, ProjectStorageError>;
    readonly saveForumStarter: (
      channelId: string,
      generation: number,
      message: SourceMessage,
      policyRevision: string,
      at: number
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly beginCycle: Effect.Effect<void, ProjectStorageError>;
    readonly claimAcquisition: (
      project: Project
    ) => Effect.Effect<HarvestTurn | null, ProjectStorageError>;
    readonly claimProcessing: (
      project: Project
    ) => Effect.Effect<string | null, ProjectStorageError>;
    readonly saveQuestions: (
      rows: readonly QuestionsRow[]
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly readQuestions: Effect.Effect<QuestionsRow[], ProjectStorageError>;
    readonly requestWake: (
      at: number
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly recordWake: Effect.Effect<void, ProjectStorageError>;
    readonly lastWake: Effect.Effect<number | null, ProjectStorageError>;
    readonly activate: (
      project: Project,
      at: number
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly progress: (
      streamId: string
    ) => Effect.Effect<FetchProgress, ProjectStorageError>;
    readonly ingestPage: (
      page: PageIngestion
    ) => Effect.Effect<IngestionCounts, ProjectStorageError>;
    readonly messages: Effect.Effect<StoredMessage[], ProjectStorageError>;
    readonly pending: (
      channelIds: readonly string[],
      limit?: number
    ) => Effect.Effect<ProcessingCandidate[], ProjectStorageError>;
    readonly complete: (
      candidate: ProcessingCandidate,
      row: QuestionsRow | null
    ) => Effect.Effect<boolean, ProjectStorageError>;
    readonly reprocess: (
      channelIds: readonly string[],
      policyRevision: string
    ) => Effect.Effect<number, ProjectStorageError>;
    readonly invalidateContext: (
      messageId: string,
      revision: string
    ) => Effect.Effect<boolean, ProjectStorageError>;
    readonly fail: (
      streamId: string,
      reason: string
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly finish: (
      project: Project,
      at: number
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly read: (
      project: Project
    ) => Effect.Effect<StoredQuestionsReply, ProjectStorageError>;
  }
>()("app/ProjectStorage") {
  static readonly layer = (storage: DurableObjectStorage) =>
    Layer.succeed(
      ProjectStorage,
      ProjectStorage.of({
        saveThreadMessages: (
          thread,
          generation,
          messages,
          policyRevision,
          at
        ) =>
          attempt("saveThreadMessages", () =>
            saveThreadMessages(
              storage,
              thread,
              generation,
              messages,
              policyRevision,
              at
            )
          ),
        schedule: attempt("schedule", () => readSchedule(storage.sql)),
        requestScheduled: (project, mode, manual, at) =>
          attempt("requestScheduled", () =>
            requestScheduledHarvest(storage, project, mode, manual, at)
          ),
        finishScheduled: (project, at) =>
          attempt("finishScheduled", () =>
            completeScheduledBatch(storage.sql, project, at)
          ),
        startScheduled: (project, at) =>
          attempt("startScheduled", () =>
            startScheduledBatch(storage, project, at)
          ),
        retry: (failure) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((at) =>
              attempt("retry", () => recordRetry(storage, failure, at))
            )
          ),
        forumRequest: (channelId, generation) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((at) =>
              attempt("forumRequest", () =>
                nextForumRequest(storage.sql, channelId, generation, at)
              )
            )
          ),
        saveThreadPage: (channelId, generation, page, at) =>
          attempt("saveThreadPage", () =>
            saveThreadPage(storage, channelId, generation, page, at)
          ),
        saveForumStarter: (
          channelId,
          generation,
          message,
          policyRevision,
          at
        ) =>
          attempt("saveForumStarter", () =>
            saveForumStarter(
              storage,
              channelId,
              generation,
              message,
              policyRevision,
              at
            )
          ),
        beginCycle: attempt("beginCycle", () => beginCycle(storage.sql)),
        claimAcquisition: (project) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((at) =>
              attempt("claimAcquisition", () =>
                claimAcquisition(storage, project, at)
              )
            )
          ),
        claimProcessing: (project) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((at) =>
              attempt("claimProcessing", () =>
                claimProcessing(storage, project, at)
              )
            )
          ),
        saveQuestions: (rows) =>
          attempt("saveQuestions", () =>
            storage.transactionSync(() => saveQuestions(storage.sql, rows))
          ),
        readQuestions: attempt("readQuestions", () =>
          readQuestions(storage.sql)
        ),
        requestWake: (at) =>
          Effect.tryPromise({
            try: async () => {
              await storage.setAlarm(at);
              storage.sql.exec(
                "UPDATE harvest_schedule SET next_alarm=? WHERE id=1",
                at
              );
            },
            catch: (cause) =>
              new ProjectStorageError({ operation: "requestWake", cause }),
          }),
        recordWake: attempt("recordWake", () => {
          storage.sql.exec(
            "UPDATE harvest_state SET last_wake = ? WHERE id = 1",
            Date.now()
          );
        }),
        lastWake: attempt(
          "lastWake",
          () =>
            storage.sql
              .exec<{ last_wake: number | null }>(
                "SELECT last_wake FROM harvest_state WHERE id = 1"
              )
              .one().last_wake
        ),
        activate: (project, at) =>
          attempt("activate", () => activateProject(storage, project, at)),
        progress: (id) =>
          attempt("progress", () => readProgress(storage.sql, id)),
        ingestPage: (page) =>
          attempt("ingestPage", () => ingestPage(storage, page)),
        messages: attempt("messages", () => readMessages(storage.sql)),
        pending: (ids, limit = 20) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((at) =>
              attempt("pending", () =>
                pendingCandidates(storage.sql, ids, limit, at)
              )
            )
          ),
        complete: (candidate, row) =>
          attempt("complete", () =>
            completeProcessing(storage, candidate, row)
          ),
        reprocess: (ids, policyRevision) =>
          attempt("reprocess", () =>
            reprocessCandidates(storage.sql, ids, policyRevision)
          ),
        invalidateContext: (messageId, revision) =>
          attempt("invalidateContext", () =>
            invalidateProcessingContext(storage.sql, messageId, revision)
          ),
        fail: (id, reason) =>
          attempt("fail", () => recordFailure(storage.sql, id, reason)),
        finish: (project, at) =>
          attempt("finish", () =>
            storage.transactionSync(() =>
              finishAttempt(storage.sql, project, at)
            )
          ),
        read: (project) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((at) =>
              attempt("read", () => readSavedProject(storage.sql, project, at))
            )
          ),
      })
    );
}
