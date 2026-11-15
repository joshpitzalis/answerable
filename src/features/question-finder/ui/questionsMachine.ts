import { createAsyncLogic, setup, types } from "xstate";

import type { QuestionsRow } from "../domain";

export const createQuestionsMachine = (load: () => Promise<QuestionsRow[]>) => {
  const loadQuestions = createAsyncLogic<QuestionsRow[]>({ run: () => load() });

  return setup({
    actors: { loadQuestions },
    schemas: {
      context: types<{ questions: QuestionsRow[]; reason: string | null }>(),
      events: { retry: types<Record<string, never>>() },
    },
  }).createMachine({
    context: { questions: [], reason: null },
    initial: "loading",
    states: {
      loading: {
        invoke: {
          src: "loadQuestions",
          onDone: ({ event }) => ({
            target: "loaded",
            context: { questions: event.output, reason: null },
          }),
          onError: ({ event }) => ({
            target: "failed",
            context: {
              reason:
                event.error instanceof Error
                  ? event.error.message
                  : String(event.error),
            },
          }),
        },
      },
      loaded: {},
      failed: {
        on: {
          retry: () => ({ target: "loading", context: { reason: null } }),
        },
      },
    },
  });
};
