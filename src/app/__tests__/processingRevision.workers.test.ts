/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { processingPolicy } from "../../features/question-finder/domain/harvest.values";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  unavailableDiscord,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("processing revisions", () => {
  it("a delayed Judge cannot publish an edited message, and duplicate edits do not rejudge", async () => {
    const project = textProject("delayed-edit");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const started = await Effect.runPromise(Deferred.make<null>());
    const released = await Effect.runPromise(Deferred.make<null>());

    const judge = Layer.succeed(
      Judge,
      Judge.of({
        answerable: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, null);
            yield* Deferred.await(released);

            return { answerable: true };
          }),
      })
    );

    await withHarvestRuntime(
      stub,
      discordPage([sourceMessage("101")]),
      judge,
      async (runtime) => {
        const running = harvestStoredProject(runtime, project, "live");
        await runtime.runPromise(Deferred.await(started));
        const store = await runtime.runPromise(ProjectStorage);
        const progress = await runtime.runPromise(store.progress("800"));
        await runtime.runPromise(
          store.ingestPage({
            messages: [sourceMessage("101", "Resolved, thank you")],
            progress,
            policyRevision: processingPolicy("live"),
            observedAt: 200,
          })
        );
        await runtime.runPromise(Deferred.succeed(released, null));
        const stale = await running;
        expect(stale.questions).toStrictEqual([]);
        expect(stale.harvest).toMatchObject({
          pendingProcessing: 1,
          lastCompleteSuccess: null,
        });
      }
    );

    const neverJudge = Layer.succeed(
      Judge,
      Judge.of({
        answerable: () => Effect.die("A nonquestion or duplicate was judged"),
      })
    );

    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      neverJudge,
      async (runtime) => {
        const recovered = await harvestStoredProject(runtime, project, "live");
        expect(recovered.harvest.pendingProcessing).toBe(0);
        const store = await runtime.runPromise(ProjectStorage);
        const progress = await runtime.runPromise(store.progress("800"));
        await runtime.runPromise(
          store.ingestPage({
            messages: [
              {
                ...sourceMessage("101", "Resolved, thank you"),
                editedAt: "2026-11-02T00:00:00.000Z",
              },
            ],
            progress,
            policyRevision: processingPolicy("live"),
            observedAt: 300,
          })
        );
        await expect(
          harvestStoredProject(runtime, project, "live")
        ).resolves.toStrictEqual(recovered);
        const stored = await runtime.runPromise(store.messages);
        expect(stored[0]?.sourceRevision).toBe(2);
      }
    );
  });

  it("context changes reject old judgments without changing the raw message revision", async () => {
    const project = textProject("context-revision");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "fixture");
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      async (runtime) => {
        const store = await runtime.runPromise(ProjectStorage);
        await runtime.runPromise(store.activate(project, 100));
        const progress = await runtime.runPromise(store.progress("800"));
        await runtime.runPromise(
          store.ingestPage({
            messages: [sourceMessage("101")],
            progress,
            policyRevision: "fixture-policy",
            observedAt: 100,
          })
        );
        const [old] = await runtime.runPromise(store.pending(["800"]));

        if (old === undefined) {
          throw new Error("Expected candidate");
        }

        await expect(
          runtime.runPromise(
            store.invalidateContext("101", "changed-title-and-reply-content")
          )
        ).resolves.toBeTruthy();
        await expect(
          runtime.runPromise(store.complete(old, null))
        ).resolves.toBeFalsy();
        const [current] = await runtime.runPromise(store.pending(["800"]));

        if (current === undefined) {
          throw new Error("Expected changed candidate");
        }

        expect(current.message.sourceRevision).toBe(1);
        await runtime.runPromise(store.complete(current, null));
        await expect(
          runtime.runPromise(
            store.invalidateContext("101", "changed-title-and-reply-content")
          )
        ).resolves.toBeFalsy();
        await expect(
          runtime.runPromise(store.pending(["800"]))
        ).resolves.toStrictEqual([]);
      }
    );
  });

  it("a superseded policy cannot mark retained content processed", async () => {
    const project = textProject("stale-policy");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "fixture");
    await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      async (runtime) => {
        const store = await runtime.runPromise(ProjectStorage);
        await runtime.runPromise(store.activate(project, 100));
        const progress = await runtime.runPromise(store.progress("800"));
        await runtime.runPromise(
          store.ingestPage({
            messages: [sourceMessage("101")],
            progress,
            observedAt: 100,
            policyRevision: "old-policy",
          })
        );
        const [old] = await runtime.runPromise(store.pending(["800"]));

        if (old === undefined) {
          throw new Error("Expected candidate");
        }

        await runtime.runPromise(store.reprocess(["800"], "next-policy"));
        await expect(
          runtime.runPromise(store.complete(old, null))
        ).resolves.toBeFalsy();
        const pending = await runtime.runPromise(store.pending(["800"]));
        expect(pending).toMatchObject([
          { policyRevision: "next-policy", message: { sourceRevision: 1 } },
        ]);
      }
    );
  });
});
