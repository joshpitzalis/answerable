/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import { forumThread, forumWire } from "./forum.test-utils";
import { textProject, withHarvestRuntime } from "./harvest.test-utils";

describe("new text threads", () => {
  it("collects a newly created active thread whose old starter was outside the seed", async () => {
    const project = textProject("new-thread-old-starter");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.channelType = 0;
    wire.state.active = [
      forumThread("101", false, "2026-11-01T00:00:01Z", "2026-11-01T00:00:00Z"),
      forumThread("201", false, "2026-11-01T00:00:01Z", "2026-10-01T00:00:00Z"),
    ];
    wire.state.messages.set("101", [
      {
        id: "102",
        channel_id: "101",
        content: "New reply",
        timestamp: "2026-11-01T00:00:02Z",
        author: { id: "901", username: "Commenter" },
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
          // oxlint-disable-next-line no-await-in-loop -- Each invocation resumes committed discovery or message work.
          reply = await harvestStoredProject(runtime, project, "live");
        }

        const store = await runtime.runPromise(ProjectStorage);
        const messages = await runtime.runPromise(store.messages);
        expect(messages.map((message) => message.id)).toStrictEqual([
          "101",
          "102",
        ]);
        expect(reply.contributorStats?.topContributors).toMatchObject([
          { name: "Commenter", responses: 1 },
          { name: "Writer", responses: 1 },
        ]);
        expect(reply.harvest.status).toBe("current");
      },
      undefined,
      { now: Date.parse("2026-11-01T00:00:00Z") }
    );
  });
});
