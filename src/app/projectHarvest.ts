import { DurableObject } from "cloudflare:workers";
import { ManagedRuntime } from "effect";

import type { WebsiteEnv } from "../../alchemy.run";
import type { Project, QuestionsRow } from "../features/question-finder/domain";
import {
  migrateProjectStorage,
  ProjectStorage,
} from "../features/question-finder/services/projectStorage";
import {
  executeProjectWake,
  readLastProjectWake,
  readProjectQuestions,
  requestProjectWake,
  saveProjectQuestions,
} from "../features/question-finder/workflows/projectStorage";

export class ProjectHarvest extends DurableObject {
  readonly #runtime: ManagedRuntime.ManagedRuntime<ProjectStorage, never>;

  constructor(ctx: DurableObjectState, env: WebsiteEnv) {
    super(ctx, env);
    this.#runtime = ManagedRuntime.make(ProjectStorage.layer(ctx.storage));
    ctx.blockConcurrencyWhile(() => {
      migrateProjectStorage(ctx.storage);

      return Promise.resolve();
    });
  }

  saveQuestions(rows: readonly QuestionsRow[]): Promise<void> {
    return this.#runtime.runPromise(saveProjectQuestions(rows));
  }

  readQuestions(): Promise<QuestionsRow[]> {
    return this.#runtime.runPromise(readProjectQuestions);
  }

  requestWake(at: number): Promise<void> {
    return this.#runtime.runPromise(requestProjectWake(at));
  }

  lastWake(): Promise<number | null> {
    return this.#runtime.runPromise(readLastProjectWake);
  }

  alarm(): Promise<void> {
    return executeProjectWake(this.#runtime);
  }
}

export const projectHarvestStub = (
  namespace: DurableObjectNamespace<ProjectHarvest>,
  project: Pick<Project, "id">,
  mode: "live" | "fixture"
) => namespace.getByName(`${mode}:${project.id}`);
