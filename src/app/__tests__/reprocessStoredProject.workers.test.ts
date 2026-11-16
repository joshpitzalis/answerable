/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Corpus } from "../../features/question-finder/services/corpus";
import type { Post } from "../../features/question-finder/services/corpus";
import {
  Judge,
  JudgeFailed,
} from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { prepareProcessing } from "../../features/question-finder/workflows/processStoredCandidates";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  unavailableDiscord,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("reprocess stored Project content", () => {
  it("reconsiders retained rejected content when evidence changes without downloading again", async () => {
    const project = textProject("evidence-change");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "fixture");

    let posts: readonly Post[] = [
      { slug: "one", title: "Layers", body: "Old evidence" },
    ];

    const corpus = Layer.succeed(
      Corpus,
      Corpus.of({ all: () => Effect.sync(() => posts) })
    );

    const first = await withHarvestRuntime(
      stub,
      discordPage([
        sourceMessage("101", "Can whales jump?"),
        sourceMessage("102", "Hello"),
      ]),
      Judge.stub,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "fixture");
        await harvestStoredProject(runtime, project, "fixture");

        return harvestStoredProject(runtime, project, "fixture");
      },
      corpus
    );

    expect(first.questions).toStrictEqual([]);
    expect(first.harvest.pendingProcessing).toBe(0);
    await evictDurableObject(stub);

    posts = [{ slug: "one", title: "Whales", body: "New evidence" }];

    const changed = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.stub,
      async (runtime) => {
        await runtime.runPromise(prepareProcessing(project, "fixture"));

        const preparing = await runtime.runPromise(
          ProjectStorage.use((store) => store.read(project))
        );

        expect(preparing.harvest).toMatchObject({
          status: "working",
          pendingProcessing: 2,
          lastCompleteSuccess: first.harvest.lastCompleteSuccess,
        });
        const reply = await harvestStoredProject(runtime, project, "fixture");

        const messages = await runtime.runPromise(
          ProjectStorage.use((store) => store.messages)
        );

        expect(messages.map((message) => message.sourceRevision)).toStrictEqual(
          [1, 1]
        );

        return reply;
      },
      corpus
    );

    expect(changed.questions.map((row) => row.id)).toStrictEqual(["101"]);
    expect(changed.harvest).toMatchObject({
      status: "current",
      pendingProcessing: 0,
    });
    expect(changed.contributorStats?.topContributors).toStrictEqual([
      { name: "Writer", responses: 2, avatarUrl: null },
    ]);
  });

  it("selects only the bounded pending work for the requested Channels", async () => {
    const project = textProject("bounded-pending");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      async (runtime) => {
        const store = await runtime.runPromise(ProjectStorage);
        await runtime.runPromise(store.activate(project, 100));
        const progress = await runtime.runPromise(store.progress("800"));

        const messages = Array.from({ length: 25 }, (_, index) =>
          sourceMessage(String(index + 101))
        );

        await runtime.runPromise(
          store.ingestPage({
            messages,
            progress,
            observedAt: 100,
            policyRevision: "test-policy",
          })
        );
        await expect(
          runtime.runPromise(store.pending(["800"], 2))
        ).resolves.toHaveLength(2);
        await expect(
          runtime.runPromise(store.pending(["900"], 2))
        ).resolves.toStrictEqual([]);
        const saved = await runtime.runPromise(store.read(project));
        expect(saved.harvest.pendingProcessing).toBe(25);
      }
    );
  });

  it("retains the last successful result when changed policy fails, then retries saved content", async () => {
    const project = textProject("policy-retry");
    const time = { now: 2_000_000_000_000 };
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "fixture");
    let title = "Whales";

    const corpus = Layer.succeed(
      Corpus,
      Corpus.of({
        all: () =>
          Effect.sync(() => [{ slug: "one", title, body: "Evidence" }]),
      })
    );

    const first = await withHarvestRuntime(
      stub,
      discordPage([sourceMessage("101", "Can whales jump?")]),
      Judge.stub,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "fixture");
        await harvestStoredProject(runtime, project, "fixture");

        return harvestStoredProject(runtime, project, "fixture");
      },
      corpus
    );

    title = "Layers";

    const failingJudge = Layer.succeed(
      Judge,
      Judge.of({
        answerable: () =>
          Effect.fail(new JudgeFailed({ reason: "Unavailable" })),
      })
    );

    const failed = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      failingJudge,
      (runtime) => harvestStoredProject(runtime, project, "fixture"),
      corpus,
      time
    );

    expect(failed.questions).toStrictEqual(first.questions);
    expect(failed.harvest).toMatchObject({
      status: "partial",
      pendingProcessing: 1,
      lastCompleteSuccess: first.harvest.lastCompleteSuccess,
    });
    await evictDurableObject(stub);

    time.now += 1000;

    const recovered = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.stub,
      (runtime) => harvestStoredProject(runtime, project, "fixture"),
      corpus,
      time
    );

    expect(recovered.questions).toStrictEqual([]);
    expect(recovered.harvest).toMatchObject({
      status: "current",
      pendingProcessing: 0,
    });
  });
});
