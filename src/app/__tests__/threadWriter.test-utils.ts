import { env } from "cloudflare:workers";

import type { DiscordThread } from "../../features/question-finder/domain/thread.values";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import type { ScheduledHarvest } from "../../features/question-finder/workflows/scheduledHarvest";
import { projectHarvestStub } from "../projectHarvest";
import {
  sourceMessage,
  textProject,
  unavailableDiscord,
} from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

export const thread = {
  id: "101",
  parentChannelId: "800",
  starterId: "101",
  title: "Question",
  archived: false,
  archiveTimestamp: "2026-11-01T00:00:00Z",
  isPost: true,
};

export const at = 2_000_000_000_000;

export const reply = (id: string) => ({
  ...sourceMessage(id),
  channelId: "101",
  threadId: "101",
});

export const withTrackedThread = (
  id: string,
  use: (
    scheduled: ScheduledHarvest,
    storage: DurableObjectStorage,
    generation: number
  ) => Promise<void>,
  tracked: DiscordThread = thread
) => {
  const project = textProject(id);
  const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

  return withScheduledHarvest(
    stub,
    { now: at },
    unavailableDiscord,
    async (scheduled, storage) => {
      await scheduled.activate(project);
      const store = await scheduled.runtime.runPromise(ProjectStorage);

      const { generation } = storage.sql
        .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
        .one();

      if (tracked.isPost === false) {
        const progress = await scheduled.runtime.runPromise(
          store.progress("800")
        );

        await scheduled.runtime.runPromise(
          store.ingestPage({
            messages: [sourceMessage(tracked.starterId)],
            progress,
            policyRevision: "test",
            observedAt: at,
          })
        );
      }

      await scheduled.runtime.runPromise(
        store.saveThreadPage(
          "800",
          generation,
          {
            scope: "active",
            threads: [tracked],
            hasMore: false,
            isForum: tracked.isPost !== false,
          },
          at
        )
      );
      await use(scheduled, storage, generation);
    }
  );
};
