import { createAsyncLogic, setup, types } from "xstate";

import type { ContributorStats, FailedChannel, QuestionsRow } from "../domain";
import type {
  HarvestStatus,
  StoredQuestionsReply,
} from "../domain/values/harvest.values";

export interface QuestionsCommands {
  load: () => Promise<StoredQuestionsReply>;
  activate: () => Promise<StoredQuestionsReply>;
  refresh: () => Promise<StoredQuestionsReply>;
}

const received = (reply: StoredQuestionsReply) => ({
  target:
    reply.harvest.status === "working" || reply.harvest.status === "waiting"
      ? "waiting"
      : "loaded",
  context: { ...reply, reason: null },
});

const failed = (reason: string) => ({
  target: "failed",
  context: { reason },
});

export const createQuestionsMachine = (commands: QuestionsCommands) => {
  const loadQuestions = createAsyncLogic({ run: commands.load });

  return setup({
    actors: {
      loadQuestions,
      activate: createAsyncLogic({ run: commands.activate }),
      refresh: createAsyncLogic({ run: commands.refresh }),
    },
    schemas: {
      context: types<{
        questions: QuestionsRow[];
        failedChannels: FailedChannel[];
        contributorStats: ContributorStats | null;
        reason: string | null;
        harvest: HarvestStatus | null;
      }>(),
      events: {
        retry: types<Record<string, never>>(),
        refresh: types<Record<string, never>>(),
      },
    },
  }).createMachine({
    context: {
      questions: [],
      failedChannels: [],
      contributorStats: null,
      reason: null,
      harvest: null,
    },
    initial: "loading",
    states: {
      loading: {
        invoke: {
          src: "loadQuestions",
          onDone: ({ event }) =>
            event.output.harvest.status === "new"
              ? {
                  target: "activating",
                  context: { ...event.output, reason: null },
                }
              : received(event.output),
          onError: ({ event }) =>
            failed(
              event.error instanceof Error
                ? event.error.message
                : String(event.error)
            ),
        },
      },
      activating: {
        invoke: {
          src: "activate",
          onDone: ({ event }) => received(event.output),
          onError: ({ event }) =>
            failed(
              event.error instanceof Error
                ? event.error.message
                : String(event.error)
            ),
        },
      },
      refreshing: {
        invoke: {
          src: "refresh",
          onDone: ({ event }) => received(event.output),
          onError: ({ event }) =>
            failed(
              event.error instanceof Error
                ? event.error.message
                : String(event.error)
            ),
        },
      },
      waiting: { after: { 2000: { target: "polling" } } },
      polling: {
        invoke: {
          src: "loadQuestions",
          onDone: ({ event }) => received(event.output),
          onError: ({ event }) =>
            failed(
              event.error instanceof Error
                ? event.error.message
                : String(event.error)
            ),
        },
      },
      loaded: {
        on: {
          refresh: ({ context }) =>
            context.harvest?.status === "current" ||
            context.harvest?.status === "partial"
              ? { target: "refreshing", context: { reason: null } }
              : undefined,
        },
      },
      failed: {
        on: {
          retry: () => ({ target: "loading", context: { reason: null } }),
          refresh: ({ context }) =>
            context.harvest?.status === "current" ||
            context.harvest?.status === "partial"
              ? { target: "refreshing", context: { reason: null } }
              : undefined,
        },
      },
    },
  });
};
