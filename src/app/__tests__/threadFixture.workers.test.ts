/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  EFFECT_PROJECT,
  XSTATE_PROJECT,
} from "../../features/question-finder/lib/projects.config.example";
import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import { withHarvestRuntime } from "./harvest.test-utils";

describe("stored fixture reply policy", () => {
  it.each([
    {
      project: EFFECT_PROJECT,
      questions: 9,
      messages: 11,
      answered: "1525693287409913856",
    },
    {
      project: XSTATE_PROJECT,
      questions: 2,
      messages: 6,
      answered: "1540000000000000002",
    },
  ])(
    "keeps fixture question behavior and counts retained replies for $project.slug",
    async ({ project, questions, messages, answered }) => {
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "fixture");
      await withHarvestRuntime(
        stub,
        Discord.stub,
        Judge.stub,
        async (runtime) => {
          let saved = await harvestStoredProject(runtime, project, "fixture");

          for (
            let batch = 0;
            batch < 40 && saved.harvest.status !== "current";
            batch += 1
          ) {
            // oxlint-disable-next-line no-await-in-loop -- Exercise bounded pages through the real fixture HTTP adapter.
            saved = await harvestStoredProject(runtime, project, "fixture");
          }

          expect(saved.harvest.status).toBe("current");
          expect(saved.questions).toHaveLength(questions);
          expect(saved.questions.map((question) => question.id)).not.toContain(
            answered
          );

          const retained = await runtime.runPromise(
            ProjectStorage.use((store) => store.messages)
          );

          // Durable contributions include the owner's retained reply; the legacy UI still counts only starters until #23.
          expect(retained).toHaveLength(messages);
          expect(
            retained.filter(
              (message) => message.channelId !== message.parentChannelId
            )
          ).toMatchObject([
            { authorName: project.ownerName, threadId: answered },
          ]);
        }
      );
    }
  );
});
