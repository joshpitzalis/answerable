/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
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

describe("forum archive continuation", () => {
  it("finds a post archived between completed checks without historical backfill", async () => {
    const project = textProject("forum-between-checks");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        const initial = await harvestStoredProject(runtime, project, "live");
        expect(initial.harvest.status).toBe("current");
        wire.state.archives.set("", {
          threads: [
            forumThread("102", true, new Date(Date.now()).toISOString()),
            forumThread("101", true, "2026-01-01T00:00:00Z"),
          ],
          has_more: false,
        });
        await runtime.runPromise(requestStoredHarvest(project));
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        const saved = await harvestStoredProject(runtime, project, "live");
        expect(saved.questions).toMatchObject([{ id: "102" }]);
        expect(saved.harvest.status).toBe("current");
      }
    );
  });

  it("resumes overlapping archive pages after eviction and excludes pre-activation archives", async () => {
    const project = textProject("forum-archive-overlap");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    const newest = forumThread("303", true, "2026-11-02T00:00:00.000001Z");
    const older = forumThread("302", true, "2026-11-01T00:00:00.000001Z");
    wire.state.archives.set("", { threads: [newest], has_more: true });
    wire.state.archives.set("2026-11-02T00:00:00.001Z", {
      threads: [
        newest,
        older,
        forumThread("301", true, "2026-10-29T00:00:00Z"),
      ],
      has_more: false,
    });
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await runtime.runPromise(
          ProjectStorage.use((store) =>
            store.activate(project, Date.parse("2026-10-30T00:00:00Z"))
          )
        );
        await runtime.runPromise(requestStoredHarvest(project));
        await harvestStoredProject(runtime, project, "live");
        const first = await harvestStoredProject(runtime, project, "live");
        expect(first.harvest.status).toBe("working");
      }
    );
    await evictDurableObject(stub);
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        const saved = await harvestStoredProject(runtime, project, "live");
        expect(saved.harvest.status).toBe("current");
        expect(saved.questions.map((row) => row.id).toSorted()).toStrictEqual([
          "302",
          "303",
        ]);

        const messages = await runtime.runPromise(
          ProjectStorage.use((store) => store.messages)
        );

        expect(messages).toHaveLength(2);
        expect(
          messages.every((message) => message.content === "Plain forum body")
        ).toBeTruthy();
      }
    );
    expect(
      wire.state.requests.filter((url) => url.pathname.endsWith("/active"))
    ).toHaveLength(1);
    expect(
      wire.state.requests.filter((url) => url.pathname.includes("/messages/"))
    ).toHaveLength(2);
  });

  it("keeps a non-progressing timestamp page partial without skipping its boundary", async () => {
    const project = textProject("forum-archive-stuck");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();

    const repeated = {
      threads: [forumThread("303", true, "2026-11-02T00:00:00.000001Z")],
      has_more: true,
    };

    wire.state.archives.set("", repeated);
    wire.state.archives.set("2026-11-02T00:00:00.001Z", repeated);
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await runtime.runPromise(
          ProjectStorage.use((store) =>
            store.activate(project, Date.parse("2026-10-30T00:00:00Z"))
          )
        );
        await runtime.runPromise(requestStoredHarvest(project));
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        const saved = await harvestStoredProject(runtime, project, "live");
        expect(saved.harvest.status).toBe("partial");
        expect(saved.harvest.lastCompleteSuccess).toBeNull();

        const request = await runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            const turn = yield* store.claimAcquisition(project);

            return turn === null
              ? null
              : yield* store.forumRequest(turn.channelId, turn.generation);
          })
        );

        expect(request).toStrictEqual({
          kind: "archive",
          before: "2026-11-02T00:00:00.001Z",
        });
      }
    );
  });
});
