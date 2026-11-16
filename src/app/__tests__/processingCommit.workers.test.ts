/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { EFFECT_PROJECT } from "../../features/question-finder/lib/projects.config.example";
import { Judge } from "../../features/question-finder/services/judge";
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

describe("processing commit", () => {
  it("finishes a committed result after interruption before freshness is saved", async () => {
    const project = textProject("finish-rollback");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_finish BEFORE UPDATE OF last_complete_success ON harvest_state BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
      );
    });
    await expect(
      withHarvestRuntime(
        stub,
        discordPage([sourceMessage("101")]),
        Judge.everythingAnswerable,
        (runtime) => harvestStoredProject(runtime, project, "live")
      )
    ).rejects.toBeInstanceOf(ProjectStorageError);
    await evictDurableObject(stub);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("DROP TRIGGER fail_finish");
    });

    const recovered = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(recovered.questions.map((row) => row.id)).toStrictEqual(["101"]);
    expect(recovered.harvest.lastCompleteSuccess).not.toBeNull();
  });

  it("rolls back processing completion when storing the question fails", async () => {
    const project = textProject("outcome-rollback");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_question BEFORE INSERT ON questions BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
      );
    });
    await expect(
      withHarvestRuntime(
        stub,
        discordPage([sourceMessage("101")]),
        Judge.everythingAnswerable,
        (runtime) => harvestStoredProject(runtime, project, "live")
      )
    ).rejects.toBeInstanceOf(ProjectStorageError);
    await evictDurableObject(stub);
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      async (runtime) => {
        const saved = await runtime.runPromise(readStoredProject(project));
        expect(saved.questions).toStrictEqual([]);
        expect(saved.harvest).toMatchObject({
          pendingProcessing: 1,
          lastCompleteSuccess: null,
        });
      }
    );
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("DROP TRIGGER fail_question");
    });

    const recovered = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(recovered.questions.map((row) => row.id)).toStrictEqual(["101"]);
    expect(recovered.harvest.pendingProcessing).toBe(0);
  });

  it("an old processing revision cannot complete edited content", async () => {
    const project = textProject("stale-result");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      async (runtime) => {
        const store = await runtime.runPromise(ProjectStorage);
        await runtime.runPromise(store.activate(project, 100));
        const progress = await runtime.runPromise(store.progress("800"));

        const page = {
          progress,
          observedAt: 100,
          policyRevision: "test-policy",
          messages: [sourceMessage("101")],
        };

        await runtime.runPromise(store.ingestPage(page));
        const [old] = await runtime.runPromise(store.pending(["800"]));

        if (old === undefined) {
          throw new Error("Expected pending candidate");
        }

        await runtime.runPromise(
          store.ingestPage({
            ...page,
            messages: [sourceMessage("101", "Edited?")],
          })
        );
        await expect(
          runtime.runPromise(store.complete(old, null))
        ).resolves.toBeFalsy();
        const pending = await runtime.runPromise(store.pending(["800"]));
        expect(pending).toHaveLength(1);
        expect(pending[0]?.message).toMatchObject({
          sourceRevision: 2,
          content: "Edited?",
        });
      }
    );
  });

  it("the native Project RPC uses the durable text path with committed fixtures", async () => {
    const project = { ...EFFECT_PROJECT, id: "effect" };
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "fixture");
    const reply = await stub.harvest(project);
    expect(
      reply.questions.some((row) => row.question.includes("clownfish"))
    ).toBeTruthy();
    await evictDurableObject(stub);
    await expect(stub.read(project)).resolves.toStrictEqual(reply);
  });
});
