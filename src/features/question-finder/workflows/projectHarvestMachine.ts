import type { ManagedRuntime } from "effect";
import { setup, types } from "xstate";

import type { ChannelFunnel, HarvestReport, Project } from "../domain";
import { createChannelHarvestMachine } from "./channelHarvestMachine";
import type { HarvestServices } from "./harvestSteps";

/**
 * One child actor per Channel, all running at once. Done when every child has
 * finished; the output is the Channels that failed and a funnel per Channel.
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
        funnels: ChannelFunnel[];
      }>(),
      events: { "channel.finished": types<{ output: ChannelFunnel }>() },
      output: types<HarvestReport>(),
    },
  }).createMachine({
    context: ({ input }) => ({
      project: input,
      pending: input.channels.length,
      funnels: [],
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
                funnels: [...context.funnels, event.output],
              },
            };
          },
        },
      },
      finished: { type: "final" },
    },
    // Channels finish in any order; report them in the Project's order.
    output: ({ context }) => {
      const funnels = context.project.channels.flatMap(({ name }) =>
        context.funnels.filter((funnel) => funnel.channel === name)
      );

      return {
        failed: funnels.flatMap(({ channel, failure }) =>
          failure === null ? [] : [{ name: channel, reason: failure.reason }]
        ),
        funnels,
      };
    },
  });
};
