import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { QuestionsRow } from "../../features/question-finder/domain";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { processCandidate } from "../../features/question-finder/workflows/processStoredCandidates";
import { projectHarvestStub } from "../projectHarvest";
import {
  sourceMessage,
  textProject,
  unavailableDiscord,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("saved Channel labels", () => {
  it("processes each candidate under its own source Channel", async () => {
    const project = {
      ...textProject("processed-channel-labels"),
      channels: [
        { id: "801", name: "Second" },
        { id: "800", name: "First" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      (runtime) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            yield* store.reconcileConfiguration(project, "live", true, 1000);
            yield* store.activate(project, 1000);
            yield* store.beginCycle;

            for (const [channelId, id] of [
              ["800", "101"],
              ["801", "102"],
            ]) {
              const progress = yield* store.progress(channelId);
              yield* store.ingestPage({
                progress,
                messages: [
                  {
                    ...sourceMessage(id),
                    channelId,
                    parentChannelId: channelId,
                    url: `https://discord.com/channels/700/${channelId}/${id}`,
                  },
                ],
                observedAt: 1000,
                policyRevision: "test",
              });
            }

            const candidates = yield* store.pending(["800", "801"]);

            for (const candidate of candidates) {
              yield* processCandidate(project, candidate, [], "live");
            }

            expect(yield* store.readQuestions).toMatchObject([
              { id: "101", channel: { id: "800", name: "First" } },
              { id: "102", channel: { id: "801", name: "Second" } },
            ]);
            expect(yield* store.pendingCount(["800", "801"])).toBe(0);
          })
        )
    );
  });

  it("resolves each row by Channel identity after configuration is reordered and renamed", async () => {
    const project = {
      ...textProject("renamed-channel-labels"),
      slug: "renamed-example",
      channels: [
        { id: "801", name: "Second renamed" },
        { id: "800", name: "First renamed" },
      ],
    };

    const first: QuestionsRow = {
      id: "101",
      project: "example",
      channel: { id: "800", name: "First original" },
      name: "Writer",
      comments: 0,
      question: "How does this work?",
      isPost: false,
      avatarUrl: null,
      dateAsked: new Date("2026-11-01T00:00:00Z"),
      url: "https://discord.com/channels/700/800/101",
    };

    const rows = [
      first,
      {
        ...first,
        id: "102",
        channel: { id: "801", name: "Second original" },
        url: "https://discord.com/channels/700/801/102",
      },
    ];

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      async (runtime) => {
        const store = await runtime.runPromise(ProjectStorage);
        await runtime.runPromise(store.saveQuestions(rows));
        await expect(
          runtime.runPromise(store.read(project))
        ).resolves.toMatchObject({
          questions: [
            {
              id: "101",
              project: "renamed-example",
              channel: { id: "800", name: "First renamed" },
            },
            {
              id: "102",
              project: "renamed-example",
              channel: { id: "801", name: "Second renamed" },
            },
          ],
        });
        await expect(
          runtime.runPromise(store.readQuestions)
        ).resolves.toStrictEqual(rows);
      }
    );
  });
});
