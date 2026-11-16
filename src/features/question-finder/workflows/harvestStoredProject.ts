import { Clock, Effect } from "effect";
import type { ManagedRuntime } from "effect";
import { createActor, setup, toPromise, types } from "xstate";

import type { Channel, Project } from "../domain";
import {
  activationBoundary,
  compareSnowflakes,
} from "../domain/harvest.values";
import type { Corpus, Post } from "../services/corpus";
import { Discord } from "../services/discord";
import type { Judge } from "../services/judge";
import { ProjectStorage } from "../services/projectStorage";
import { fromEffect } from "./fromEffect";
import { prepareProcessing, processCandidate } from "./processStoredCandidates";

export type StoredHarvestServices = ProjectStorage | Discord | Judge | Corpus;

export const readStoredProject = (project: Project) =>
  Effect.flatMap(ProjectStorage, (store) => store.read(project));

const seedChannel = (
  project: Project,
  channel: Channel,
  policyRevision: string
) =>
  Effect.gen(function* () {
    const store = yield* ProjectStorage;
    const progress = yield* store.progress(channel.id);

    if (progress.seeded) {
      return;
    }

    const at = yield* Clock.currentTimeMillis;

    const messages = yield* Discord.use((discord) =>
      discord.messagePage({
        channelId: channel.id,
        parentChannelId: channel.id,
        serverId: project.serverId,
        before: null,
        limit: 50,
      })
    );

    const newest = messages.toSorted((left, right) =>
      compareSnowflakes(right.id, left.id)
    )[0]?.id;

    const counts = yield* store.ingestPage({
      messages,
      observedAt: at,
      policyRevision,
      progress: {
        ...progress,
        completedBoundary: newest ?? activationBoundary(at),
        seeded: true,
        lastCompletedAt: at,
        failure: null,
      },
    });

    yield* Effect.logInfo(
      `harvest ingestion inserted=${counts.inserted} updated=${counts.updated} unchanged=${counts.unchanged}`
    );
  }).pipe(
    Effect.catchTag("DiscordFailed", () =>
      ProjectStorage.use((store) =>
        store.fail(channel.id, "Discord could not be read")
      )
    ),
    Effect.catchTag("DiscordRateLimited", () =>
      ProjectStorage.use((store) =>
        store.fail(channel.id, "Discord is rate-limited")
      )
    )
  );

export const harvestStoredProject = async (
  runtime: ManagedRuntime.ManagedRuntime<StoredHarvestServices, never>,
  project: Project,
  mode: "live" | "fixture"
) => {
  const machine = setup({
    schemas: {
      context: types<{ posts: readonly Post[]; policyRevision: string }>(),
    },
    actors: {
      prepare: fromEffect(runtime, () =>
        Effect.gen(function* () {
          yield* readStoredProject(project);
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
      activate: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          yield* ProjectStorage.use((store) => store.activate(project, at));
        })
      ),
      acquire: fromEffect(runtime, (policyRevision: string) =>
        Effect.forEach(
          project.channels,
          (channel) => seedChannel(project, channel, policyRevision),
          { discard: true }
        )
      ),
      process: fromEffect(runtime, (posts: readonly Post[]) =>
        Effect.gen(function* () {
          const pending = yield* ProjectStorage.use((store) =>
            store.pending(project.channels.map((channel) => channel.id))
          );

          yield* Effect.forEach(
            pending,
            (candidate) => processCandidate(project, candidate, posts),
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
    context: { posts: [], policyRevision: "" },
    initial: "preparing",
    states: {
      preparing: {
        invoke: {
          src: "prepare",
          input: undefined,
          onDone: ({ event }) => ({
            target: event.output.current ? "done" : "activating",
            context: {
              posts: event.output.posts,
              policyRevision: event.output.policyRevision,
            },
          }),
        },
      },
      activating: {
        invoke: {
          src: "activate",
          input: undefined,
          onDone: () => ({ target: "acquiring" }),
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
          onDone: () => ({ target: "finishing" }),
        },
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

  const actor = createActor(machine);

  try {
    const done = toPromise(actor);
    actor.start();
    await done;

    return await runtime.runPromise(readStoredProject(project));
  } finally {
    actor.stop();
  }
};
