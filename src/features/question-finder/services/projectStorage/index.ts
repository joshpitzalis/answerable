import { Context, Effect, Layer, Schema } from "effect";

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
import type { ForumRequest, ThreadPage } from "../../domain/thread.values";
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
        forumRequest: (channelId, generation) =>
          attempt("forumRequest", () =>
            nextForumRequest(storage.sql, channelId, generation)
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
          attempt("claimAcquisition", () => claimAcquisition(storage, project)),
        claimProcessing: (project) =>
          attempt("claimProcessing", () => claimProcessing(storage, project)),
        saveQuestions: (rows) =>
          attempt("saveQuestions", () =>
            storage.transactionSync(() => saveQuestions(storage.sql, rows))
          ),
        readQuestions: attempt("readQuestions", () =>
          readQuestions(storage.sql)
        ),
        requestWake: (at) =>
          Effect.tryPromise({
            try: () => storage.setAlarm(at),
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
          attempt("pending", () => pendingCandidates(storage.sql, ids, limit)),
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
          attempt("read", () => readSavedProject(storage.sql, project)),
      })
    );
}
