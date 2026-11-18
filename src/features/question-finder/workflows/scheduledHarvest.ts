import { Clock, Effect } from "effect";
import type { ManagedRuntime } from "effect";
import { createActor, createAsyncLogic, setup, toPromise } from "xstate";

import type { Project } from "../domain";
import { RECOVERY_DELAY } from "../domain/schedule.values";
import { ProjectStorage } from "../services/projectStorage";
import { fromEffect } from "./fromEffect";
import type { HarvestClock } from "./harvestQuestions";
import {
  harvestStoredProject,
  readStoredProject,
} from "./harvestStoredProject";
import type { StoredHarvestServices } from "./harvestStoredProject";

type Runtime = ManagedRuntime.ManagedRuntime<StoredHarvestServices, never>;

const request = (project: Project, mode: "live" | "fixture", manual: boolean) =>
  Effect.gen(function* () {
    const store = yield* ProjectStorage;
    const at = yield* Clock.currentTimeMillis;
    const before = yield* store.schedule;

    if (!manual && before.projectId !== null) {
      return yield* store.read(project);
    }

    // Arm before first activation commits: every crash leaves either no work or an existing wake.
    yield* store.requestWake(at + RECOVERY_DELAY);
    yield* store.requestScheduled(project, mode, manual, at);
    const after = yield* store.schedule;

    if (after.nextDue !== null) {
      yield* store.requestWake(after.nextDue);
    }

    return yield* store.read(project);
  });

const runDue = async (
  runtime: Runtime,
  project: Project,
  mode: "live" | "fixture",
  clock?: HarvestClock
) => {
  const machine = setup({
    actors: {
      prepare: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const store = yield* ProjectStorage;
          const at = yield* Clock.currentTimeMillis;
          const schedule = yield* store.schedule;

          if (schedule.nextDue === null) {
            return "done";
          }

          if (Math.max(schedule.nextDue, schedule.globalPause) > at) {
            yield* store.requestWake(
              Math.max(schedule.nextDue, schedule.globalPause)
            );

            return "done";
          }

          yield* store.requestWake(at + RECOVERY_DELAY);
          const saved = yield* store.read(project);

          if (
            schedule.runGeneration !== null &&
            saved.harvest.status === "current"
          ) {
            return "scheduling";
          }

          yield* store.startScheduled(project, at);

          return "harvesting";
        })
      ),
      batch: createAsyncLogic({
        run: () => harvestStoredProject(runtime, project, mode, clock),
      }),
      schedule: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const store = yield* ProjectStorage;
          const at = yield* Clock.currentTimeMillis;
          const next = yield* store.finishScheduled(project, at);

          if (next !== null) {
            yield* store.requestWake(next);
          }
        })
      ),
    },
  }).createMachine({
    initial: "preparing",
    states: {
      preparing: {
        invoke: {
          src: "prepare",
          input: undefined,
          onDone: ({ event }) => ({
            target: event.output,
          }),
        },
      },
      harvesting: {
        invoke: {
          src: "batch",
          input: undefined,
          onDone: () => ({ target: "scheduling" }),
        },
      },
      scheduling: {
        invoke: {
          src: "schedule",
          input: undefined,
          onDone: () => ({ target: "done" }),
        },
      },
      done: { type: "final" },
    },
  });

  const actor = createActor(machine);

  try {
    const completed = toPromise(actor);
    actor.start();
    await completed;
  } finally {
    actor.stop();
  }
};

export class ScheduledHarvest {
  #running: Promise<void> | null = null;
  readonly runtime: Runtime;
  readonly mode: "live" | "fixture";
  readonly clock: HarvestClock | undefined;
  readonly enabled: boolean;

  constructor(
    runtime: Runtime,
    mode: "live" | "fixture",
    clock?: HarvestClock,
    enabled = true
  ) {
    this.runtime = runtime;
    this.mode = mode;
    this.clock = clock;
    this.enabled = enabled;
  }

  async activate(project: Project) {
    if (await this.reconcile(project)) {
      return this.runtime.runPromise(readStoredProject(project));
    }

    return this.runtime.runPromise(request(project, this.mode, false));
  }

  async request(project: Project) {
    if (await this.reconcile(project)) {
      return this.runtime.runPromise(readStoredProject(project));
    }

    if (this.#running !== null) {
      return this.read(project);
    }

    return this.runtime.runPromise(request(project, this.mode, true));
  }

  async read(project: Project) {
    await this.reconcile(project);

    return this.runtime.runPromise(readStoredProject(project));
  }

  reconcile(project: Project | undefined) {
    const { mode, enabled } = this;

    return this.runtime.runPromise(
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis;
        const store = yield* ProjectStorage;

        return yield* store.reconcileConfiguration(project, mode, enabled, at);
      })
    );
  }

  alarm(project: Project | undefined): Promise<void> {
    const configured = this.reconcile(project);

    if (this.#running !== null) {
      const running = this.#running;

      return configured.then(() => running);
    }

    const running = configured.then((suspended) =>
      suspended || project === undefined
        ? undefined
        : runDue(this.runtime, project, this.mode, this.clock)
    );

    this.#running = running;

    return running.finally(() => {
      this.#running = null;
    });
  }
}
