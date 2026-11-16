import { DurableObject } from "cloudflare:workers";
import type { ManagedRuntime } from "effect";

import type { WebsiteEnv } from "../../alchemy.run";
import type { Project, QuestionsRow } from "../features/question-finder/domain";
import { Discord } from "../features/question-finder/services/discord";
import { Judge } from "../features/question-finder/services/judge";
import { migrateProjectStorage } from "../features/question-finder/services/projectStorage";
import {
  harvestStoredProject,
  readStoredProject,
  requestStoredHarvest,
} from "../features/question-finder/workflows/harvestStoredProject";
import type { StoredHarvestServices } from "../features/question-finder/workflows/harvestStoredProject";
import {
  executeProjectWake,
  readLastProjectWake,
  readProjectQuestions,
  requestProjectWake,
  saveProjectQuestions,
} from "../features/question-finder/workflows/projectStorage";
import { createProjectHarvestRuntime } from "./projectHarvestRuntime";

export class ProjectHarvest extends DurableObject {
  readonly #runtime: ManagedRuntime.ManagedRuntime<
    StoredHarvestServices,
    never
  >;
  readonly #mode: "live" | "fixture";

  constructor(ctx: DurableObjectState, env: WebsiteEnv) {
    super(ctx, env);
    this.#mode = env.DISCORD_BOT_TOKEN ? "live" : "fixture";
    this.#runtime = createProjectHarvestRuntime(
      ctx.storage,
      env.DISCORD_BOT_TOKEN
        ? Discord.layerSkippingReplyCheck(env.DISCORD_BOT_TOKEN)
        : Discord.stub,
      env.DISCORD_BOT_TOKEN ? Judge.everythingAnswerable : Judge.stub
    );
    ctx.blockConcurrencyWhile(() => {
      migrateProjectStorage(ctx.storage);

      return Promise.resolve();
    });
  }

  saveQuestions(rows: readonly QuestionsRow[]): Promise<void> {
    return this.#runtime.runPromise(saveProjectQuestions(rows));
  }

  harvest(project: Project) {
    return harvestStoredProject(this.#runtime, project, this.#mode);
  }

  requestHarvest(project: Project) {
    return this.#runtime.runPromise(requestStoredHarvest(project));
  }

  read(project: Project) {
    return this.#runtime.runPromise(readStoredProject(project));
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
