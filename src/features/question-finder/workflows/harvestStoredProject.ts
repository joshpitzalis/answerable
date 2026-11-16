import { Clock, Effect } from "effect";
import type { ManagedRuntime } from "effect";
import { createActor, setup, toPromise, types } from "xstate";

import type { Project } from "../domain";
import type { Corpus, Post } from "../services/corpus";
import type { Discord } from "../services/discord";
import type { Judge } from "../services/judge";
import { ProjectStorage } from "../services/projectStorage";
import { acquireStoredPage } from "./acquireStoredPage";
import { fromEffect } from "./fromEffect";
import type { HarvestClock } from "./harvestQuestions";
import { prepareProcessing, processCandidate } from "./processStoredCandidates";

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
  const machine = setup({
    schemas: {
      context: types<{ posts: readonly Post[]; policyRevision: string }>(),
    },
    actors: {
      prepare: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const initial = yield* readStoredProject(project);

          if (initial.harvest.activatedAt === null) {
            yield* requestStoredHarvest(project);
          }

          const prepared = yield* prepareProcessing(project, mode);
          const saved = yield* readStoredProject(project);

          return {
            ...prepared,
            current:
              saved.harvest.status === "current" &&
              saved.harvest.lastCompleteSuccess !== null,
          };
        })
      ),
      acquire: fromEffect(runtime, (policyRevision: string) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          yield* ProjectStorage.use((store) => store.activate(project, at));
          yield* acquireStoredPage(project, policyRevision);
        })
      ),
      process: fromEffect(runtime, (posts: readonly Post[]) =>
        Effect.gen(function* () {
          const store = yield* ProjectStorage;
          const channelId = yield* store.claimProcessing(project);

          if (channelId === null) {
            return;
          }

          const candidates = yield* store.pending([channelId], 20);
          yield* Effect.forEach(
            candidates,
            (candidate) => processCandidate(project, candidate, posts, mode),
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
    id: "storedHarvest",
    context: { posts: [], policyRevision: "" },
    initial: "working",
    states: {
      working: {
        initial: "preparing",
        timeout: 20_000,
        onTimeout: () => ({ target: "#storedHarvest.done" }),
        states: {
          preparing: {
            invoke: {
              src: "prepare",
              input: undefined,
              onDone: ({ event }) => ({
                target: event.output.current
                  ? "#storedHarvest.done"
                  : "acquiring",
                context: {
                  posts: event.output.posts,
                  policyRevision: event.output.policyRevision,
                },
              }),
            },
          },
          acquiring: {
            invoke: {
              src: "acquire",
              input: ({ context }) => context.policyRevision,
              onDone: () => ({ target: "processing" }),
            },
          },
          processing: {
            invoke: {
              src: "process",
              input: ({ context }) => context.posts,
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
