/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  Judge,
  JudgeFailed,
} from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { readStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { processCandidate } from "../../features/question-finder/workflows/processStoredCandidates";
import { projectHarvestStub } from "../projectHarvest";
import {
  sourceMessage,
  textProject,
  unavailableDiscord,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("edited question retention", () => {
  it.each([true, false])(
    "retains the saved row through failed judgment, then commits answerable=%s",
    async (answerable) => {
      const project = textProject(`retained-edit-${answerable}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      let fail = false;
      let verdict = true;

      const judge = Layer.succeed(
        Judge,
        Judge.of({
          answerable: () =>
            fail
              ? Effect.fail(new JudgeFailed({ reason: "unavailable" }))
              : Effect.succeed({ answerable: verdict }),
        })
      );

      await withHarvestRuntime(
        stub,
        unavailableDiscord,
        judge,
        async (runtime) => {
          const store = await runtime.runPromise(ProjectStorage);
          await runtime.runPromise(store.activate(project, 100));
          const progress = await runtime.runPromise(store.progress("800"));

          const page = {
            progress,
            observedAt: 100,
            policyRevision: "test-policy",
          };

          await runtime.runPromise(
            store.ingestPage({ ...page, messages: [sourceMessage("101")] })
          );
          const [original] = await runtime.runPromise(store.pending(["800"]));

          if (original === undefined) {
            throw new Error("Expected initial candidate");
          }

          await runtime.runPromise(
            processCandidate(project, original, [], "live")
          );
          const saved = await runtime.runPromise(readStoredProject(project));
          expect(saved.questions).toMatchObject([
            { question: "How do Layers work?" },
          ]);

          await runtime.runPromise(
            store.ingestPage({
              ...page,
              messages: [sourceMessage("101", "How do scopes work?")],
            })
          );
          const [edited] = await runtime.runPromise(store.pending(["800"]));

          if (edited === undefined) {
            throw new Error("Expected edited candidate");
          }

          fail = true;
          await runtime.runPromise(
            processCandidate(project, edited, [], "live")
          );
          const failed = await runtime.runPromise(readStoredProject(project));
          expect(failed.questions).toStrictEqual(saved.questions);
          expect(failed.harvest.pendingProcessing).toBe(1);

          fail = false;
          verdict = answerable;
          await runtime.runPromise(
            processCandidate(project, edited, [], "live")
          );

          const completed = await runtime.runPromise(
            readStoredProject(project)
          );

          expect(completed.questions).toMatchObject(
            answerable ? [{ question: "How do scopes work?" }] : []
          );
          expect(completed.harvest.pendingProcessing).toBe(0);
        }
      );
    }
  );
});
