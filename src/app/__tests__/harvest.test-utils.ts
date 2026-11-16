import { runInDurableObject } from "cloudflare:test";
import { Effect, Layer } from "effect";
import type { ManagedRuntime } from "effect";

import type { Project } from "../../features/question-finder/domain";
import type { SourceMessage } from "../../features/question-finder/domain/harvest.values";
import { Corpus } from "../../features/question-finder/services/corpus";
import { Discord } from "../../features/question-finder/services/discord";
import type { Judge } from "../../features/question-finder/services/judge";
import type { StoredHarvestServices } from "../../features/question-finder/workflows/harvestStoredProject";
import type { ProjectHarvest } from "../projectHarvest";
import { createProjectHarvestRuntime } from "../projectHarvestRuntime";

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
      messagePage: () => Effect.succeed(messages),
    })
  );

export const unavailableDiscord = Layer.succeed(
  Discord,
  Discord.of({
    messagesSince: () => Effect.die("Unexpected Discord call"),
    hasReplyFrom: () => Effect.die("Unexpected Discord call"),
    messagePage: () =>
      Effect.die("Committed content must not be downloaded again"),
  })
);

export const withHarvestRuntime = <A>(
  stub: DurableObjectStub<ProjectHarvest>,
  discord: Layer.Layer<Discord>,
  judge: Layer.Layer<Judge>,
  use: (
    runtime: ManagedRuntime.ManagedRuntime<StoredHarvestServices, never>
  ) => Promise<A>,
  corpus: Layer.Layer<Corpus> = Corpus.stub
) =>
  runInDurableObject(stub, async (_instance, state) => {
    const runtime = createProjectHarvestRuntime(
      state.storage,
      discord,
      judge,
      corpus
    );

    try {
      return await use(runtime);
    } finally {
      await runtime.dispose();
    }
  });
