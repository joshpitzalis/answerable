/// <reference types="@cloudflare/vitest-plugin/types" />
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

const reply = (id: string) => ({
  id,
  channel_id: "101",
  content: "Reply",
  timestamp: new Date().toISOString(),
  author: { id: "901", username: "Commenter" },
});

describe("tracked thread archive lifecycle", () => {
  it("collects a final archived tail, rests archived threads, and resumes after reactivation", async () => {
    const project = textProject("thread-archive");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.active = [forumThread("101")];
    wire.state.messages.set("101", [reply("102")]);
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        const collect = async () => {
          let result = await harvestStoredProject(runtime, project, "live");

          for (
            let batch = 0;
            batch < 10 && result.harvest.status !== "current";
            batch += 1
          ) {
            // oxlint-disable-next-line no-await-in-loop -- Each batch resumes the saved acquisition obligation.
            result = await harvestStoredProject(runtime, project, "live");
          }

          expect(result.harvest.status).toBe("current");

          return result;
        };

        const initial = await collect();
        expect(initial.questions[0]?.comments).toBe(1);
        wire.state.active = [];
        wire.state.messages.get("101")?.push(reply("103"));
        wire.state.archives.set("", {
          threads: [forumThread("101", true, new Date().toISOString())],
          has_more: false,
        });
        await runtime.runPromise(requestStoredHarvest(project));
        const archived = await collect();
        expect(archived.questions[0]?.comments).toBe(2);

        const collectedPages = wire.state.requests.filter((url) =>
          url.pathname.endsWith("/101/messages")
        ).length;

        await runtime.runPromise(requestStoredHarvest(project));
        await collect();
        expect(
          wire.state.requests.filter((url) =>
            url.pathname.endsWith("/101/messages")
          )
        ).toHaveLength(collectedPages);
        wire.state.archives.clear();
        wire.state.active = [forumThread("101")];
        wire.state.messages.get("101")?.push(reply("104"));
        await runtime.runPromise(requestStoredHarvest(project));
        const reactivated = await collect();
        expect(reactivated.questions[0]?.comments).toBe(3);
      }
    );
  });
});
