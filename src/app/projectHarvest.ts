import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import type { ManagedRuntime } from "effect";

import type { WebsiteEnv } from "../../alchemy.run";
import type { Project, QuestionsRow } from "../features/question-finder/domain";
import { Discord } from "../features/question-finder/services/discord";
import { Judge } from "../features/question-finder/services/judge";
import {
  migrateProjectStorage,
  ProjectStorage,
} from "../features/question-finder/services/projectStorage";
import {
  harvestStoredProject,
  readStoredProject,
} from "../features/question-finder/workflows/harvestStoredProject";
import type { StoredHarvestServices } from "../features/question-finder/workflows/harvestStoredProject";
import {
  executeProjectWake,
  readLastProjectWake,
  readProjectQuestions,
  requestProjectWake,
  saveProjectQuestions,
} from "../features/question-finder/workflows/projectStorage";
import { ScheduledHarvest } from "../features/question-finder/workflows/scheduledHarvest";
import { resolveHarvestProject } from "./projectHarvestConfig";
import { createProjectHarvestRuntime } from "./projectHarvestRuntime";

export class ProjectHarvest extends DurableObject {
  readonly #runtime: ManagedRuntime.ManagedRuntime<
    StoredHarvestServices,
    never
  >;
  readonly #mode: "live" | "fixture";
  readonly #scheduled: ScheduledHarvest;

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
    this.#scheduled = new ScheduledHarvest(this.#runtime, this.#mode);
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
    return this.#scheduled.request(this.#project(project.id));
  }

  activate(projectId: string) {
    return this.#scheduled.activate(this.#project(projectId));
  }

  #project(projectId: string): Project {
    const project = resolveHarvestProject(projectId, this.#mode);

    if (
      project === undefined ||
      this.ctx.id.name !== `${this.#mode}:${project.id}`
    ) {
      throw new Error("Unknown Project storage identity");
    }

    return project;
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

  async alarm(): Promise<void> {
    await executeProjectWake(this.#runtime);

    const schedule = await this.#runtime.runPromise(
      Effect.flatMap(ProjectStorage, (store) => store.schedule)
    );

    if (schedule.projectId === null) {
      return;
    }

    const project = resolveHarvestProject(schedule.projectId, this.#mode);

    if (project === undefined || schedule.mode !== this.#mode) {
      return;
    }

    await this.#scheduled.alarm(project);
  }
}

export const projectHarvestStub = (
  namespace: DurableObjectNamespace<ProjectHarvest>,
  project: Pick<Project, "id">,
  mode: "live" | "fixture"
) => namespace.getByName(`${mode}:${project.id}`);
