import { Match } from "effect";
import type { ManagedRuntime } from "effect";
import { setup, types } from "xstate";

import type {
  Channel,
  DiscordMessage,
  FailedChannel,
  Project,
  QuestionsRow,
  Snowflake,
} from "../domain";
import { looksLikeAQuestion } from "../domain";
import {
  DiscordFailed,
  DiscordRateLimited,
} from "../services/discord/lib/errors";
import { JudgeFailed } from "../services/judge";
import { fromEffect } from "./fromEffect";
import type { HarvestServices } from "./harvestSteps";
import {
  dropRepliedThreads,
  fetchNewMessages,
  keepAnswerable,
  saveThenAdvance,
} from "./harvestSteps";

interface StepErrorEvent {
  readonly error: unknown;
}

const reasonOf = ({ error }: StepErrorEvent): string =>
  Match.value(error).pipe(
    Match.whenOr(
      Match.instanceOf(DiscordFailed),
      Match.instanceOf(JudgeFailed),
      (failure) => failure.reason
    ),
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse(String)
  );

type Step = "fetching" | "checkingReplies" | "judging" | "saving";

/** Retries a Channel run gets after Discord rate-limits it, across all its steps. */
const MAX_RETRIES = 2;

interface ChannelContext {
  project: Project;
  channel: Channel;
  /** The messages the next step works on. */
  batch: readonly DiscordMessage[];
  rows: readonly QuestionsRow[];
  /** Newest message read: where the cursor goes once the rows are saved. */
  newest: Snowflake | null;
  /** The step that failed or was rate-limited, so `waiting` can re-enter it. */
  failedStep: Step | null;
  reason: string | null;
  /** Rate-limit retries used so far in this Channel run. */
  retries: number;
  /** How long Discord asked the Channel to wait. */
  waitMs: number;
}

/**
 * One Channel's Harvest. Flow only: every step is one Effect over the whole
 * batch. The Channel ends in `done` or `failed` and never rejects, so a failure
 * is data for the Project and cannot touch a sibling.
 */
export const createChannelHarvestMachine = (
  runtime: ManagedRuntime.ManagedRuntime<HarvestServices, never>
) => {
  /**
   * The one place `onError` is wired. A rate limit waits and re-enters the step
   * while the Channel run's retry budget lasts; anything else ends the Channel.
   */
  const failedIn =
    (step: Step) =>
    ({
      context,
      event,
    }: {
      context: ChannelContext;
      event: StepErrorEvent;
    }) => {
      const { error } = event;

      if (
        error instanceof DiscordRateLimited &&
        context.retries < MAX_RETRIES
      ) {
        return {
          target: "waiting" as const,
          context: {
            failedStep: step,
            retries: context.retries + 1,
            waitMs: error.retryAfterMs,
          },
        };
      }

      return {
        target: "failed" as const,
        context: {
          failedStep: step,
          reason:
            error instanceof DiscordRateLimited
              ? `Rate-limited by Discord: still limited after ${MAX_RETRIES} retries`
              : reasonOf(event),
        },
      };
    };

  return setup({
    delays: { discordRetryAfter: ({ context }) => context.waitMs },
    actors: {
      fetchNewMessages: fromEffect(runtime, fetchNewMessages),
      dropRepliedThreads: fromEffect(runtime, dropRepliedThreads),
      keepAnswerable: fromEffect(runtime, keepAnswerable),
      saveThenAdvance: fromEffect(runtime, saveThenAdvance),
    },
    schemas: {
      input: types<{ project: Project; channel: Channel }>(),
      context: types<ChannelContext>(),
      output: types<FailedChannel | null>(),
    },
  }).createMachine({
    context: ({ input }) => ({
      project: input.project,
      channel: input.channel,
      batch: [],
      rows: [],
      newest: null,
      failedStep: null,
      reason: null,
      retries: 0,
      waitMs: 0,
    }),
    initial: "fetching",
    states: {
      fetching: {
        invoke: {
          src: "fetchNewMessages",
          input: ({ context }) => ({
            project: context.project,
            channel: context.channel,
          }),
          onDone: ({ event }) => {
            const newest = event.output.at(-1);

            if (newest === undefined) {
              return { target: "done" };
            }

            return {
              target: "checkingReplies",
              context: {
                batch: event.output.filter(looksLikeAQuestion),
                newest: newest.id,
              },
            };
          },
          onError: failedIn("fetching"),
        },
      },
      checkingReplies: {
        invoke: {
          src: "dropRepliedThreads",
          input: ({ context }) => ({
            project: context.project,
            messages: context.batch,
          }),
          onDone: ({ event }) => ({
            target: "judging",
            context: { batch: event.output },
          }),
          onError: failedIn("checkingReplies"),
        },
      },
      judging: {
        invoke: {
          src: "keepAnswerable",
          input: ({ context }) => ({
            project: context.project,
            channel: context.channel,
            messages: context.batch,
          }),
          onDone: ({ event }) => ({
            target: "saving",
            context: { rows: event.output },
          }),
          onError: failedIn("judging"),
        },
      },
      saving: {
        invoke: {
          src: "saveThenAdvance",
          input: ({ context }) => ({
            channel: context.channel,
            rows: context.rows,
            newest: context.newest,
          }),
          onDone: { target: "done" },
          onError: failedIn("saving"),
        },
      },
      waiting: {
        after: {
          discordRetryAfter: ({ context }) => ({
            target: context.failedStep ?? "fetching",
          }),
        },
      },
      done: { type: "final" },
      failed: { type: "final" },
    },
    output: ({ context }) =>
      context.reason === null
        ? null
        : { name: context.channel.name, reason: context.reason },
  });
};
