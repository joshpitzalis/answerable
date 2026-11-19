import { Effect } from "effect";
import type { ManagedRuntime } from "effect";
import { createActor, setup, toPromise } from "xstate";

import type { QuestionsRow } from "../domain";
import { ProjectStorage } from "../services/projectStorage";
import { fromEffect } from "./fromEffect";

export const saveProjectQuestions = (rows: readonly QuestionsRow[]) =>
  Effect.flatMap(ProjectStorage, (store) => store.saveQuestions(rows));

export const readProjectQuestions = Effect.flatMap(
  ProjectStorage,
  (store) => store.readQuestions
);

export const requestProjectWake = (at: number) =>
  Effect.flatMap(ProjectStorage, (store) => store.requestWake(at));

export const readLastProjectWake = Effect.flatMap(
  ProjectStorage,
  (store) => store.lastWake
);

export const executeProjectWake = async (
  runtime: ManagedRuntime.ManagedRuntime<ProjectStorage, never>
): Promise<void> => {
  const machine = setup({
    actors: {
      record: fromEffect(runtime, () =>
        Effect.flatMap(ProjectStorage, (store) => store.recordWake)
      ),
    },
  }).createMachine({
    initial: "recording",
    states: {
      recording: {
        invoke: {
          src: "record",
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
