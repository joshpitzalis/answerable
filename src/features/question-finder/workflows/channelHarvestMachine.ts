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
import { DiscordFailed } from "../services/discord/lib/errors";
import { JudgeFailed } from "../services/judge";
import { fromEffect } from "./fromEffect";
import type { HarvestServices } from "./harvestSteps";
import {
  dropRepliedThreads,
  fetchNewMessages,
  keepAnswerable,
  saveThenAdvance,
} from "./harvestSteps";

interface Rejection {
  readonly error: unknown;
}

const reasonOf = ({ error }: Rejection): string =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(DiscordFailed), (failure) => failure.reason),
    Match.when(Match.instanceOf(JudgeFailed), (failure) => failure.reason),
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse(String)
  );

type Step = "fetching" | "checkingReplies" | "judging" | "saving";

/**
 * One Channel's Harvest. Flow only: every step is one Effect over the whole
 * batch. The Channel ends in `done` or `failed` and never rejects, so a failure
 * is data for the Project and cannot touch a sibling.
 */
export const createChannelHarvestMachine = (
  runtime: ManagedRuntime.ManagedRuntime<HarvestServices, never>
) => {
  const failedIn = (step: Step) => (event: Rejection) => ({
    target: "failed" as const,
    context: { failedStep: step, reason: reasonOf(event) },
  });

  return setup({
    actors: {
      fetchNewMessages: fromEffect(runtime, fetchNewMessages),
      dropRepliedThreads: fromEffect(runtime, dropRepliedThreads),
      keepAnswerable: fromEffect(runtime, keepAnswerable),
      saveThenAdvance: fromEffect(runtime, saveThenAdvance),
    },
    schemas: {
      input: types<{ project: Project; channel: Channel }>(),
      context: types<{
        project: Project;
        channel: Channel;
        /** The messages the next step works on. */
        batch: readonly DiscordMessage[];
        rows: readonly QuestionsRow[];
        /** Newest message read: where the cursor goes once the rows are saved. */
        newest: Snowflake | null;
        /** The step that failed, so a retry can re-enter it. */
        failedStep: Step | null;
        reason: string | null;
      }>(),
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
          onError: ({ event }) => failedIn("fetching")(event),
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
          onError: ({ event }) => failedIn("checkingReplies")(event),
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
          onError: ({ event }) => failedIn("judging")(event),
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
          onError: ({ event }) => failedIn("saving")(event),
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
