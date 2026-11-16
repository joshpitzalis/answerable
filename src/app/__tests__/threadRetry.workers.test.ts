/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { Corpus } from "../../features/question-finder/services/corpus";
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

describe("thread retry scheduling", () => {
  it("retains saved replies and progress when a tracked thread disappears", async () => {
    const project = textProject("thread-missing");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.active = [forumThread("101")];
    wire.state.messages.set("101", [
      {
        id: "102",
        channel_id: "101",
        content: "Saved reply",
        timestamp: "2026-11-01T00:00:00Z",
        author: { id: "901", username: "Commenter" },
      },
    ]);
    let missing = false;

    const fetch: typeof globalThis.fetch = (input, init) =>
      missing && String(input).includes("/101/messages?")
        ? Promise.resolve(Response.json({ code: 10_003 }, { status: 404 }))
        : wire.fetch(input, init);

    await withHarvestRuntime(
      stub,
      Discord.layer("invented", fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        for (let batch = 0; batch < 4; batch += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Finish discovery, starter and first reply page.
          await harvestStoredProject(runtime, project, "live");
        }

        missing = true;
        wire.state.active = [];
        await runtime.runPromise(requestStoredHarvest(project));

        for (let batch = 0; batch < 3; batch += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Discover the disappearance then attempt the tracked stream.
          await harvestStoredProject(runtime, project, "live");
        }

        const saved = await runtime.runPromise(
          ProjectStorage.use((store) => store.read(project))
        );

        expect(saved).toMatchObject({
          harvest: { status: "partial" },
          questions: [{ id: "101", comments: 1 }],
        });
        expect(saved.failedChannels).toHaveLength(1);

        const progress = await runtime.runPromise(
          ProjectStorage.use((store) => store.progress("101"))
        );

        expect(progress.completedBoundary).toBe("102");
      }
    );
  });

  it("delays one thread independently while collecting its sibling within five requests per batch", async () => {
    const project = textProject("thread-retry");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    const wire = forumWire();
    wire.state.active = [forumThread("101"), forumThread("201")];
    wire.state.messages.set("201", [
      {
        id: "202",
        channel_id: "201",
        content: "Sibling reply",
        timestamp: "2026-11-01T00:00:00Z",
        author: { id: "901", username: "Sibling" },
      },
    ]);
    let limited = true;
    let requests = 0;

    const fetch: typeof globalThis.fetch = (input, init) => {
      requests += 1;

      if (limited && String(input).includes("/101/messages?")) {
        return Promise.resolve(
          Response.json({ retry_after: 60, global: false }, { status: 429 })
        );
      }

      return wire.fetch(input, init);
    };

    await withHarvestRuntime(
      stub,
      Discord.layer("invented", fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        for (let batch = 0; batch < 6; batch += 1) {
          requests = 0;
          // oxlint-disable-next-line no-await-in-loop -- Each committed batch claims one independent unit.
          await harvestStoredProject(runtime, project, "live");
          expect(requests).toBeLessThanOrEqual(5);
        }

        const saved = await runtime.runPromise(
          ProjectStorage.use((store) => store.read(project))
        );

        expect(saved).toMatchObject({
          harvest: { status: "partial" },
          questions: [
            { id: "101", comments: 0 },
            { id: "201", comments: 1 },
          ],
        });

        const deadline = await runtime.runPromise(
          ProjectStorage.use((store) =>
            store.finishScheduled(project, time.now)
          )
        );

        expect(deadline).toBe(time.now + 60_000);
        requests = 0;
        await harvestStoredProject(runtime, project, "live");
        expect(requests).toBe(0);
        limited = false;
        time.now += 60_000;
        const recovered = await harvestStoredProject(runtime, project, "live");
        expect(recovered).toMatchObject({
          harvest: { status: "current" },
          failedChannels: [],
        });
      },
      Corpus.stub,
      time
    );
  });
});
