/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import { forumThread, forumWire } from "./forum.test-utils";
import { textProject, withHarvestRuntime } from "./harvest.test-utils";

describe("text-thread collection", () => {
  it("discovers the real public thread and preserves its parent question when its system starter overlaps", async () => {
    const project = textProject("text-thread-discovery");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.channelType = 0;
    wire.state.active = [forumThread("101")];
    const original = { id: "101", channel_id: "800", content: "How do Layers work?", timestamp: "2026-11-01T00:00:00Z", author: { id: "900", username: "Writer" } };
    wire.state.messages.set("800", [original]);
    wire.state.messages.set("101", [{ ...original, channel_id: "101", content: "" }, { ...original, id: "102", channel_id: "101", content: "Reply?", author: { id: "901", username: "Reader" } }]);
    await withHarvestRuntime(stub, Discord.layer("invented", wire.fetch), Judge.everythingAnswerable, async runtime => {
      let reply = await harvestStoredProject(runtime, project, "live");
      for(let batch=0; batch<10 && reply.harvest.status !== "current"; batch+=1) {
        // oxlint-disable-next-line no-await-in-loop -- Each call resumes persisted acquisition.
        reply = await harvestStoredProject(runtime, project, "live");
      }
      expect(reply.questions).toMatchObject([{ id: "101", isPost: false, question: "How do Layers work?", comments: 1, url: "https://discord.com/channels/700/800/101" }]);
      expect(reply.contributorStats?.topContributors).toHaveLength(2);
    });
  });
});
