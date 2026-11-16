import { Clock, Effect } from "effect";
import type { ManagedRuntime } from "effect";
import { createActor, setup, toPromise } from "xstate";

import type { Project } from "../domain";
import { processingPolicy } from "../domain/harvest.values";
import type { Corpus } from "../services/corpus";
import type { Discord } from "../services/discord";
import type { Judge } from "../services/judge";
import { ProjectStorage } from "../services/projectStorage";
import { acquireStoredPage } from "./acquireStoredPage";
import { fromEffect } from "./fromEffect";
import type { HarvestClock } from "./harvestQuestions";
import { processCandidate } from "./processStoredCandidates";

export type StoredHarvestServices = ProjectStorage | Discord | Judge | Corpus;

export const readStoredProject = (project: Project) =>
  Effect.flatMap(ProjectStorage, (store) => store.read(project));

export const requestStoredHarvest = (project: Project) =>
  Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const store = yield* ProjectStorage;
    yield* store.activate(project, at);
    yield* store.beginCycle;
  });

export const harvestStoredProject = async (
  runtime: ManagedRuntime.ManagedRuntime<StoredHarvestServices, never>,
  project: Project,
  mode: "live" | "fixture",
  clock?: HarvestClock
) => {
  const saved = await runtime.runPromise(readStoredProject(project));

  if (
    saved.harvest.status === "current" &&
    saved.harvest.lastCompleteSuccess !== null
  ) {
    return saved;
  }

  if (saved.harvest.activatedAt === null) {
    await runtime.runPromise(requestStoredHarvest(project));
  }

  const machine = setup({
    actors: {
      acquire: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          yield* ProjectStorage.use((store) => store.activate(project, at));
          yield* acquireStoredPage(project, processingPolicy(mode));
        })
      ),
      process: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const store = yield* ProjectStorage;
          const channelId = yield* store.claimProcessing(project);

          if (channelId === null) {
            return;
          }

          const candidates = yield* store.pending([channelId]);
          yield* Effect.forEach(
            candidates.slice(0, 20),
            (candidate) => processCandidate(project, candidate),
            { concurrency: 4, discard: true }
          );
        })
      ),
      finish: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          yield* ProjectStorage.use((store) => store.finish(project, at));
        })
      ),
    },
  }).createMachine({
    initial: "working",
    states: {
      working: {
        initial: "acquiring",
        timeout: 20_000,
        onTimeout: () => ({ target: "finishing" }),
        states: {
          acquiring: {
            invoke: {
              src: "acquire",
              input: undefined,
              onDone: () => ({ target: "processing" }),
            },
          },
          processing: {
            invoke: {
              src: "process",
              input: undefined,
              onDone: () => ({ target: "done" }),
            },
          },
          done: { type: "final" },
        },
        onDone: () => ({ target: "finishing" }),
      },
      finishing: {
        invoke: {
          src: "finish",
          input: undefined,
          onDone: () => ({ target: "done" }),
        },
      },
      done: { type: "final" },
    },
  });

  const actor = createActor(
    machine,
    clock === undefined ? undefined : { clock }
  );

  try {
    const done = toPromise(actor);
    actor.start();
    await done;

    return await runtime.runPromise(readStoredProject(project));
  } finally {
    actor.stop();
  }
};
