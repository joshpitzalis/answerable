import { Context, Effect, Layer, Schema } from "effect";

import type { Project } from "../domain";
import type { StoredQuestionsReply } from "../domain/values/harvest.values";

interface HarvestRemote {
  readonly read: (project: Project) => Promise<StoredQuestionsReply>;
  readonly activate: (projectId: string) => Promise<StoredQuestionsReply>;
  readonly requestHarvest: (project: Project) => Promise<StoredQuestionsReply>;
}

export class HarvestAccessError extends Schema.TaggedError<HarvestAccessError>()(
  "HarvestAccessError",
  { operation: Schema.String, cause: Schema.Defect() }
) {}

const request = (
  operation: string,
  send: () => Promise<StoredQuestionsReply>
) =>
  Effect.tryPromise({
    try: send,
    catch: (cause) => new HarvestAccessError({ operation, cause }),
  });

export class HarvestAccess extends Context.Service<
  HarvestAccess,
  {
    readonly read: (
      project: Project
    ) => Effect.Effect<StoredQuestionsReply, HarvestAccessError>;
    readonly activate: (
      project: Project
    ) => Effect.Effect<StoredQuestionsReply, HarvestAccessError>;
    readonly refresh: (
      project: Project
    ) => Effect.Effect<StoredQuestionsReply, HarvestAccessError>;
  }
>()("app/HarvestAccess") {
  static readonly layer = (resolve: (project: Project) => HarvestRemote) =>
    Layer.succeed(
      HarvestAccess,
      HarvestAccess.of({
        read: (project) =>
          request("read", () => resolve(project).read(project)),
        activate: (project) =>
          request("activate", () => resolve(project).activate(project.id)),
        refresh: (project) =>
          request("refresh", () => resolve(project).requestHarvest(project)),
      })
    );
}
