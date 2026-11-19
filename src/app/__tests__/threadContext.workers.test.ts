/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { Layer, Logger } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import {
  harvestStoredProject,
  requestStoredHarvest,
} from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import { forumThread, forumWire } from "./forum.test-utils";
import { textProject, withHarvestRuntime } from "./harvest.test-utils";

describe("stored thread context", () => {
  it("combines title and reply edits while excluding bot and webhook contributions", async () => {
    const project = textProject("thread-context");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "fixture");
    const wire = forumWire();
    const lines: string[] = [];
    wire.state.active = [forumThread("101")];

    const reply = {
      id: "102",
      channel_id: "101",
      content: "Answered",
      timestamp: "2026-11-01T00:00:00Z",
      author: { id: "901", username: "Owner" },
    };

    wire.state.messages.set("101", [
      reply,
      {
        ...reply,
        id: "103",
        author: { id: "902", username: "Bot", bot: true },
      },
      {
        ...reply,
        id: "104",
        webhook_id: "500",
        author: { id: "903", username: "Webhook" },
      },
    ]);
    await withHarvestRuntime(
      stub,
      Layer.merge(
        Discord.layer("invented", wire.fetch),
        Logger.layer([
          Logger.make(({ message }) => {
            lines.push(String(message));
          }),
        ])
      ),
      Judge.everythingAnswerable,
      async (runtime) => {
        const collect = async () => {
          let result = await harvestStoredProject(runtime, project, "fixture");

          for (
            let batch = 0;
            batch < 10 && result.harvest.status !== "current";
            batch += 1
          ) {
            // oxlint-disable-next-line no-await-in-loop -- Finish each durable discovery and reply page.
            result = await harvestStoredProject(runtime, project, "fixture");
          }

          expect(result.harvest.status).toBe("current");

          return result;
        };

        const first = await collect();
        expect({
          questions: first.questions,
          contributors: first.contributorStats?.topContributors.length,
        }).toStrictEqual({ questions: [], contributors: 2 });
        expect(lines).toContain(
          "harvest channel=1 evaluated=1 questions=1 unanswered=0 kept=0 failed=0 pending=0"
        );
        wire.state.active = [
          { ...forumThread("101"), name: "Renamed question" },
        ];
        wire.state.messages.set("101", [
          {
            ...reply,
            content: "Actually another author",
            author: { id: "904", username: "Other" },
          },
        ]);
        await runtime.runPromise(requestStoredHarvest(project));
        const changed = await collect();
        expect(changed.questions).toMatchObject([
          { question: "Renamed question\n\nPlain forum body", comments: 3 },
        ]);
        expect(changed.contributorStats?.topContributors).toHaveLength(2);
        expect(
          changed.contributorStats?.topContributors
            .map((author) => author.name)
            .toSorted()
        ).toStrictEqual(["Other", "Writer"]);
      }
    );
  });
});
