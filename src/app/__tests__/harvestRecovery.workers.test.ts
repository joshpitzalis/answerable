/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  Judge,
  JudgeFailed,
} from "../../features/question-finder/services/judge";
import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import {
  harvestStoredProject,
  readStoredProject,
} from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  unavailableDiscord,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("durable Harvest", () => {
  it("retries saved pending content after a Judge failure and reconstruction without redownloading", async () => {
    const project = textProject("judge-retry");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    const failing = Layer.succeed(
      Judge,
      Judge.of({
        answerable: () => Effect.fail(new JudgeFailed({ reason: "offline" })),
      })
    );

    const reply = await withHarvestRuntime(
      stub,
      discordPage([sourceMessage("101")]),
      failing,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(reply.harvest).toMatchObject({
      status: "partial",
      pendingProcessing: 1,
      lastCompleteSuccess: null,
    });
    expect(reply.failedChannels).toStrictEqual([
      { name: "help", reason: "Saved messages could not be judged" },
    ]);
    await evictDurableObject(stub);

    const recovered = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(recovered.questions.map((row) => row.id)).toStrictEqual(["101"]);
    expect(recovered.harvest.pendingProcessing).toBe(0);
    expect(recovered.harvest.status).toBe("current");
  });

  it("a failed page transaction leaves neither content nor progress, then can be retried", async () => {
    const project = textProject("page-rollback");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_second BEFORE INSERT ON messages WHEN NEW.id = '102' BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END"
      );
    });
    const wire = discordPage([sourceMessage("101"), sourceMessage("102")]);
    await expect(
      withHarvestRuntime(stub, wire, Judge.everythingAnswerable, (runtime) =>
        harvestStoredProject(runtime, project, "live")
      )
    ).rejects.toBeInstanceOf(ProjectStorageError);
    await evictDurableObject(stub);
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      async (runtime) => {
        await expect(
          runtime.runPromise(ProjectStorage.use((store) => store.messages))
        ).resolves.toStrictEqual([]);
        await expect(
          runtime.runPromise(
            ProjectStorage.use((store) => store.progress("800"))
          )
        ).resolves.toMatchObject({ seeded: false, completedBoundary: null });
        const saved = await runtime.runPromise(readStoredProject(project));
        expect(saved.harvest.pendingProcessing).toBe(0);
      }
    );
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("DROP TRIGGER fail_second");
    });

    const recovered = await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(recovered.questions.map((row) => row.id)).toStrictEqual([
      "101",
      "102",
    ]);
  });

  it("duplicate pages keep distinct message and author identities without rejudging unchanged content", async () => {
    const project = textProject("duplicate-pages");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    const messages = [
      sourceMessage("101"),
      { ...sourceMessage("102"), authorId: "901" },
      { ...sourceMessage("103", "A bot"), authorIsBot: true },
      { ...sourceMessage("104", "Webhook"), authorIsWebhook: true },
    ];

    await withHarvestRuntime(
      stub,
      discordPage(messages),
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      async (runtime) => {
        const progress = await runtime.runPromise(
          ProjectStorage.use((store) => store.progress("800"))
        );

        const counts = await runtime.runPromise(
          ProjectStorage.use((store) =>
            store.ingestPage({
              messages,
              progress,
              policyRevision: "question-mark-v1:accept-all-v1:replies-off",
              observedAt: 123,
            })
          )
        );

        expect(counts).toStrictEqual({ inserted: 0, updated: 0, unchanged: 4 });
        await expect(
          runtime.runPromise(
            ProjectStorage.use((store) => store.pending(["800"]))
          )
        ).resolves.toStrictEqual([]);
        const reply = await runtime.runPromise(readStoredProject(project));
        expect(reply.questions.map((row) => row.id)).toStrictEqual([
          "101",
          "102",
        ]);
        expect(reply.contributorStats?.topContributors).toStrictEqual([
          { name: "Writer", responses: 1, avatarUrl: null },
          { name: "Writer", responses: 1, avatarUrl: null },
        ]);
        await expect(
          runtime.runPromise(ProjectStorage.use((store) => store.messages))
        ).resolves.toHaveLength(4);
      }
    );
  });

  it("an empty initial Channel records a boundary and completes without a Judge call", async () => {
    const project = textProject("empty-seed");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    const judge = Layer.succeed(
      Judge,
      Judge.of({ answerable: () => Effect.die("empty input called Judge") })
    );

    await withHarvestRuntime(stub, discordPage([]), judge, async (runtime) => {
      const reply = await harvestStoredProject(runtime, project, "live");
      expect(reply.questions).toStrictEqual([]);
      expect(reply.harvest.status).toBe("current");

      const progress = await runtime.runPromise(
        ProjectStorage.use((store) => store.progress("800"))
      );

      expect(progress.seeded).toBeTruthy();
      expect(progress.completedBoundary).toMatch(/^[0-9]+$/u);
    });
  });
});
