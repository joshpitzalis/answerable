/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
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

describe("stored thread comments", () => {
  it("resumes a thread longer than two pages after eviction without turning replies into questions", async () => {
    const project = textProject("thread-pages");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.active = [forumThread("101")];
    const base = {
      channel_id: "101",
      content: "Reply?",
      timestamp: "2026-11-01T00:00:00Z",
      author: { id: "901", username: "Commenter" },
    };
    wire.state.messages.set(
      "101",
      Array.from({ length: 121 }, (_, index) => ({
        ...base,
        id: String(index + 101),
      }))
    );
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        for (let batch = 0; batch < 4; batch += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Interrupt after the first committed thread page.
          await harvestStoredProject(runtime, project, "live");
        }
      }
    );
    await evictDurableObject(stub);
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        let reply = await harvestStoredProject(runtime, project, "live");

        for (
          let batch = 0;
          batch < 10 && reply.harvest.status !== "current";
          batch += 1
        ) {
          // oxlint-disable-next-line no-await-in-loop -- Resume the saved page continuation.
          reply = await harvestStoredProject(runtime, project, "live");
        }

        expect(reply.questions).toMatchObject([
          {
            id: "101",
            comments: 120,
            question: "Forum 101\n\nPlain forum body",
          },
        ]);
        expect(reply.questions).toHaveLength(1);
        expect(reply.contributorStats?.topContributors).toMatchObject([
          { name: "Commenter", responses: 120 },
          { name: "Writer", responses: 1 },
        ]);
      }
    );
    expect(
      wire.state.requests
        .filter((url) => url.pathname.endsWith("/101/messages"))
        .map((url) => url.searchParams.get("before"))
    ).toEqual([null, "172", "122"]);
  });

  it.each(["live", "fixture"] as const)(
    "keeps reply contributions but applies stored owner exclusion only in %s mode",
    async (mode) => {
      const project = textProject(`thread-policy-${mode}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, mode);
      const wire = forumWire();
      wire.state.active = [forumThread("101")];
      wire.state.messages.set("101", [
        {
          id: "102",
          channel_id: "101",
          content: "Already answered",
          timestamp: "2026-11-01T00:00:00Z",
          author: { id: "901", username: "Owner" },
        },
      ]);
      await withHarvestRuntime(
        stub,
        Discord.layer("invented", wire.fetch),
        Judge.everythingAnswerable,
        async (runtime) => {
          let reply = await harvestStoredProject(runtime, project, mode);

          for (
            let batch = 0;
            batch < 10 && reply.harvest.status !== "current";
            batch += 1
          ) {
            // oxlint-disable-next-line no-await-in-loop -- Each batch resumes durable work.
            reply = await harvestStoredProject(runtime, project, mode);
          }

          expect(reply.questions).toHaveLength(mode === "live" ? 1 : 0);
          expect(reply.contributorStats?.topContributors).toMatchObject([
            { responses: 1 },
            { responses: 1 },
          ]);
        }
      );
    }
  );

  it("keeps an overlapping starter once and collects a new reply on an old thread after eviction", async () => {
    const project = textProject("thread-replies");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.active = [forumThread("101")];
    const starter = {
      id: "101",
      channel_id: "101",
      content: "Plain forum body",
      timestamp: "2026-11-01T00:00:00Z",
      author: { id: "900", username: "Writer" },
    };
    wire.state.messages.set("101", [
      starter,
      {
        ...starter,
        id: "102",
        content: "A reply?",
        author: { id: "901", username: "Writer" },
      },
    ]);
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        let reply = await harvestStoredProject(runtime, project, "live");

        for (
          let batch = 0;
          batch < 10 && reply.harvest.status !== "current";
          batch += 1
        ) {
          // oxlint-disable-next-line no-await-in-loop -- Successive bounded batches resume durable work.
          reply = await harvestStoredProject(runtime, project, "live");
        }

        expect(reply.questions).toMatchObject([{ id: "101", comments: 1 }]);
        expect(reply.contributorStats?.topContributors).toMatchObject([
          { name: "Writer", responses: 1 },
          { name: "Writer", responses: 1 },
        ]);
      }
    );
    await evictDurableObject(stub);
    wire.state.messages
      .get("101")
      ?.push({
        ...starter,
        id: "103",
        content: "Another reply",
        author: { id: "902", username: "Later" },
      });
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await runtime.runPromise(requestStoredHarvest(project));
        let reply = await harvestStoredProject(runtime, project, "live");

        for (
          let batch = 0;
          batch < 10 && reply.harvest.status !== "current";
          batch += 1
        ) {
          // oxlint-disable-next-line no-await-in-loop -- Successive bounded batches resume durable work.
          reply = await harvestStoredProject(runtime, project, "live");
        }

        expect(reply.questions).toMatchObject([{ id: "101", comments: 2 }]);
        expect(reply.questions).toHaveLength(1);
        expect(reply.contributorStats?.topContributors).toHaveLength(3);
      }
    );
  });
});
