import type { ManagedRuntime } from "effect";
import { setup, types } from "xstate";

import type { FailedChannel, Project } from "../domain";
import { createChannelHarvestMachine } from "./channelHarvestMachine";
import type { HarvestServices } from "./harvestSteps";

/**
 * One child actor per Channel, all running at once. Done when every child has
 * finished; the output is the Channels that failed.
 */
export const createProjectHarvestMachine = (
  runtime: ManagedRuntime.ManagedRuntime<HarvestServices, never>
) => {
  const channelHarvest = createChannelHarvestMachine(runtime);

  return setup({
    schemas: {
      input: types<Project>(),
      context: types<{
        project: Project;
        pending: number;
        failed: FailedChannel[];
      }>(),
      events: { "channel.finished": types<{ output: FailedChannel | null }>() },
      output: types<FailedChannel[]>(),
    },
  }).createMachine({
    context: ({ input }) => ({
      project: input,
      pending: input.channels.length,
      failed: [],
    }),
    initial: "running",
    states: {
      running: {
        entry: ({ context }, enq) => {
          for (const channel of context.project.channels) {
            const child = enq.spawn(channelHarvest, {
              id: `channel-${channel.id}`,
              input: { project: context.project, channel },
            });

            enq.subscribeTo(child, {
              done: (output) => ({ type: "channel.finished", output }),
            });
          }
        },
        // A Project with no Channels would otherwise wait forever.
        always: ({ context }) =>
          context.pending === 0 ? { target: "finished" } : undefined,
        on: {
          "channel.finished": ({ context, event }) => {
            const pending = context.pending - 1;

            // The last child leaves `pending` at 0 and the `always` above finishes.
            return {
              context: {
                pending,
                failed:
                  event.output === null
                    ? context.failed
                    : [...context.failed, event.output],
              },
            };
          },
        },
      },
      finished: { type: "final" },
    },
    output: ({ context }) => context.failed,
  });
};
