import { Clock, Effect } from "effect";
import type { ManagedRuntime } from "effect";
import { createActor, setup, toPromise } from "xstate";

import type { Channel, Project } from "../domain";
import { looksLikeAQuestion, toRow } from "../domain";
import {
  activationBoundary,
  compareSnowflakes,
  processingPolicy,
} from "../domain/harvest.values";
import type { ProcessingCandidate } from "../domain/harvest.values";
import { Corpus } from "../services/corpus";
import { Discord } from "../services/discord";
import { Judge } from "../services/judge";
import { ProjectStorage } from "../services/projectStorage";
import { fromEffect } from "./fromEffect";

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

const processCandidate = (project: Project, candidate: ProcessingCandidate) =>
  Effect.gen(function* () {
    const store = yield* ProjectStorage;

    const channel = project.channels.find(
      (item) => item.id === candidate.message.parentChannelId
    );

    if (channel === undefined) {
      return;
    }

    const message = {
      ...candidate.message,
      createdAt: new Date(candidate.message.createdAt),
    };

    if (!looksLikeAQuestion(message)) {
      yield* store.complete(candidate, null);

      return;
    }

    const posts = yield* Corpus.use((corpus) => corpus.all(project.id));

    const verdict = yield* Judge.use((judge) =>
      judge.answerable(message.content, posts)
    );

    yield* store.complete(
      candidate,
      verdict.answerable ? toRow(message, project, channel) : null
    );
  }).pipe(
    Effect.catchTag("JudgeFailed", () =>
      ProjectStorage.use((store) =>
        store.fail(
          candidate.message.parentChannelId,
          "Saved messages could not be judged"
        )
      )
    )
  );

export const harvestStoredProject = async (
  runtime: ManagedRuntime.ManagedRuntime<StoredHarvestServices, never>,
  project: Project,
  mode: "live" | "fixture"
) => {
  const saved = await runtime.runPromise(readStoredProject(project));

  if (
    saved.harvest.status === "current" &&
    saved.harvest.lastCompleteSuccess !== null
  ) {
    return saved;
  }

  const machine = setup({
    actors: {
      activate: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          yield* ProjectStorage.use((store) => store.activate(project, at));
        })
      ),
      acquire: fromEffect(runtime, () =>
        Effect.forEach(
          project.channels,
          (channel) => seedChannel(project, channel, processingPolicy(mode)),
          { discard: true }
        )
      ),
      process: fromEffect(runtime, () =>
        Effect.gen(function* () {
          const pending = yield* ProjectStorage.use((store) =>
            store.pending(project.channels.map((channel) => channel.id))
          );

          yield* Effect.forEach(
            pending,
            (candidate) => processCandidate(project, candidate),
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
    initial: "activating",
    states: {
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
          input: undefined,
          onDone: () => ({ target: "processing" }),
        },
      },
      processing: {
        invoke: {
          src: "process",
          input: undefined,
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
