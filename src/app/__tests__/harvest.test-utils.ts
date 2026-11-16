import { runInDurableObject } from "cloudflare:test";
import { Effect, Layer, ManagedRuntime } from "effect";

import type { Project } from "../../features/question-finder/domain";
import type { SourceMessage } from "../../features/question-finder/domain/harvest.values";
import { Corpus } from "../../features/question-finder/services/corpus";
import { Discord } from "../../features/question-finder/services/discord";
import type { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import type { StoredHarvestServices } from "../../features/question-finder/workflows/harvestStoredProject";
import type { ProjectHarvest } from "../projectHarvest";
import { testClock } from "./scheduledHarvest.test-utils";

export const textProject = (id: string): Project => ({
  id,
  slug: "example",
  label: "Example",
  serverId: "700",
  channels: [{ id: "800", name: "help" }],
  ownerName: "Owner",
});

export const sourceMessage = (
  id: string,
  content = "How do Layers work?"
): SourceMessage => ({
  id,
  channelId: "800",
  parentChannelId: "800",
  threadId: null,
  authorId: "900",
  authorName: "Writer",
  authorAvatarUrl: null,
  authorIsBot: false,
  authorIsWebhook: false,
  content,
  createdAt: "2026-11-01T00:00:00.000Z",
  editedAt: null,
  replyCount: 0,
  isPost: false,
  url: `https://discord.com/channels/700/800/${id}`,
});

export const discordPage = (messages: readonly SourceMessage[]) =>
  Layer.succeed(
    Discord,
    Discord.of({
      messagesSince: () => Effect.die("Legacy acquisition must not run"),
      hasReplyFrom: () =>
        Effect.die("Standalone messages have no thread endpoint"),
      sourcePage: (request) =>
        Effect.succeed(
          request.forum === undefined
            ? messages
            : {
                threads: [],
                scope: request.forum.kind === "archive" ? "archive" : "active",
                hasMore: false,
                isForum: false,
              }
        ),
    })
  );

export const unavailableDiscord = Layer.succeed(
  Discord,
  Discord.of({
    messagesSince: () => Effect.die("Unexpected Discord call"),
    hasReplyFrom: () => Effect.die("Unexpected Discord call"),
    sourcePage: () =>
      Effect.die("Committed content must not be downloaded again"),
  })
);

export const discoveryOnlyDiscord = Layer.succeed(
  Discord,
  Discord.of({
    messagesSince: () => Effect.die("Legacy acquisition must not run"),
    hasReplyFrom: () => Effect.die("Separate reply checks must not run"),
    sourcePage: (request) => {
      if (
        request.forum?.kind === "active" ||
        request.forum?.kind === "archive"
      ) {
        return Effect.succeed({
          threads: [],
          scope: request.forum.kind === "active" ? "active" : "archive",
          hasMore: false,
          isForum: false,
        });
      }

      return Effect.die("Committed content must not be downloaded again");
    },
  })
);

export const withHarvestRuntime = <A>(
  stub: DurableObjectStub<ProjectHarvest>,
  discord: Layer.Layer<Discord>,
  judge: Layer.Layer<Judge>,
  use: (
    runtime: ManagedRuntime.ManagedRuntime<StoredHarvestServices, never>
  ) => Promise<A>,
  corpus: Layer.Layer<Corpus> = Corpus.stub,
  time?: { now: number }
) =>
  runInDurableObject(stub, async (_instance, state) => {
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        ProjectStorage.layer(state.storage),
        discord,
        judge,
        corpus,
        time === undefined ? Layer.empty : testClock(time)
      )
    );

    try {
      return await use(runtime);
    } finally {
      await runtime.dispose();
    }
  });
