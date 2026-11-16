/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import {
  harvestStoredProject,
  requestStoredHarvest,
} from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import { forumThread, forumWire } from "./forum.test-utils";
import { textProject, withHarvestRuntime } from "./harvest.test-utils";

describe("forum processing context", () => {
  it("reprocesses a changed title without downloading or duplicating the stored starter", async () => {
    const project = textProject("forum-title-change");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.active = [forumThread("101")];
    const judged: string[] = [];

    const judge = Layer.succeed(
      Judge,
      Judge.of({
        answerable: (question) =>
          Effect.sync(() => {
            judged.push(question);

            return { answerable: true };
          }),
      })
    );

    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      judge,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        wire.state.active = [
          { ...forumThread("101"), name: "A changed title" },
        ];
        await runtime.runPromise(requestStoredHarvest(project));
        const updated = await harvestStoredProject(runtime, project, "live");
        expect(updated.questions).toMatchObject([
          { id: "101", question: "A changed title\n\nPlain forum body" },
        ]);
        expect(judged).toStrictEqual([
          "Forum 101\n\nPlain forum body",
          "A changed title\n\nPlain forum body",
        ]);
        expect(
          wire.state.requests.filter((url) =>
            url.pathname.includes("/messages/")
          )
        ).toHaveLength(1);

        const stored = await runtime.runPromise(
          ProjectStorage.use((store) => store.messages)
        );

        expect(stored).toMatchObject([
          { id: "101", content: "Plain forum body" },
        ]);
        expect(updated.contributorStats?.topContributors).toMatchObject([
          { responses: 1 },
        ]);
      }
    );
  });

  it("keeps a text sibling's saved question when a forum starter is forbidden", async () => {
    const project = {
      ...textProject("forum-failed-sibling"),
      channels: [
        { id: "800", name: "forum" },
        { id: "801", name: "text" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.active = [forumThread("101")];

    const fetch: typeof globalThis.fetch = (input, init) => {
      const path = new URL(String(input)).pathname;

      if (path.endsWith("/channels/801")) {
        return Promise.resolve(
          Response.json({
            id: "801",
            guild_id: "700",
            type: 0,
            permission_overwrites: [],
          })
        );
      }

      if (path.endsWith("/channels/801/messages")) {
        return Promise.resolve(
          Response.json([
            {
              id: "201",
              channel_id: "801",
              content: "How does Effect work?",
              timestamp: "2026-11-01T00:00:00Z",
              author: { id: "900", username: "Writer" },
            },
          ])
        );
      }

      if (path.endsWith("/channels/101/messages/101")) {
        return Promise.resolve(
          Response.json({ code: 50_001 }, { status: 403 })
        );
      }

      return wire.fetch(input, init);
    };

    await withHarvestRuntime(
      stub,
      Discord.layer("invented", fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        const saved = await harvestStoredProject(runtime, project, "live");
        expect(saved.questions).toMatchObject([{ id: "201" }]);
        expect(saved.failedChannels).toStrictEqual([
          { name: "forum", reason: "Discord could not be read" },
        ]);
        expect(saved.harvest.status).toBe("partial");
        expect(saved.harvest.lastCompleteSuccess).toBeNull();
      }
    );
  });
});
