import { createAsyncLogic, setup, types } from "xstate";

import type { FailedChannel, QuestionsReply, QuestionsRow } from "../domain";

export const createQuestionsMachine = (load: () => Promise<QuestionsReply>) => {
  const loadQuestions = createAsyncLogic<QuestionsReply>({ run: () => load() });

  return setup({
    actors: { loadQuestions },
    schemas: {
      context: types<{
        questions: QuestionsRow[];
        failedChannels: FailedChannel[];
        reason: string | null;
      }>(),
      events: { retry: types<Record<string, never>>() },
    },
  }).createMachine({
    context: { questions: [], failedChannels: [], reason: null },
    initial: "loading",
    states: {
      loading: {
        invoke: {
          src: "loadQuestions",
          onDone: ({ event }) => ({
            target: "loaded",
            context: {
              questions: event.output.questions,
              failedChannels: event.output.failedChannels,
              reason: null,
            },
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
