import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import {
  sourceMessage,
  textProject,
  unavailableDiscord,
} from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("saved Channel failures", () => {
  it("deduplicates repeated reports without merging sibling Channels or distinct reasons", async () => {
    const project = {
      ...textProject("failure-identities"),
      channels: [
        { id: "800", name: "first" },
        { id: "801", name: "second" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    await withScheduledHarvest(
      stub,
      time,
      unavailableDiscord,
      async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            yield* store.ingestPage({
              progress: yield* store.progress("800"),
              messages: [sourceMessage("101")],
              observedAt: time.now,
              policyRevision: "test",
            });
            yield* store.retry({
              kind: "acquisition",
              workId: "800",
              channelId: "800",
              reason: "Collection unavailable",
            });
            yield* store.retry({
              kind: "acquisition",
              workId: "801",
              channelId: "801",
              reason: "Collection unavailable",
            });
            yield* store.retry({
              kind: "processing",
              workId: "101",
              channelId: "800",
              reason: "Judgement unavailable",
            });
          })
        );
        const saved = await scheduled.read(project);
        expect(saved.failedChannels).toHaveLength(3);
        expect(saved.failedChannels).toStrictEqual(
          expect.arrayContaining([
            { name: "first", reason: "Collection unavailable" },
            { name: "second", reason: "Collection unavailable" },
            { name: "first", reason: "Judgement unavailable" },
          ])
        );
      }
    );
  });
});
