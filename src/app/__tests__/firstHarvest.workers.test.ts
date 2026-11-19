/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { SimulatedClock } from "xstate";

import { Judge } from "../../features/question-finder/services/judge";
import {
  harvestStoredProject,
  readStoredProject,
} from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  unavailableDiscord,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("saved Project reads", () => {
  it("retains questions and nonquestions across reconstruction without external calls", async () => {
    const project = textProject("first-harvest");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    const reply = await withHarvestRuntime(
      stub,
      discordPage([sourceMessage("101"), sourceMessage("100", "Hello")]),
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");

        return harvestStoredProject(runtime, project, "live");
      }
    );

    expect(reply.questions.map((row) => row.id)).toStrictEqual(["101"]);
    expect(reply.contributorStats?.topContributors).toStrictEqual([
      { name: "Writer", responses: 2, avatarUrl: null },
    ]);
    expect(reply.harvest).toMatchObject({
      status: "current",
      initialCoverage: "latest-50",
    });
    await evictDurableObject(stub);

    const judge = Layer.succeed(
      Judge,
      Judge.of({ answerable: () => Effect.die("read called Judge") })
    );

    const saved = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      judge,
      (runtime) => runtime.runPromise(readStoredProject(project))
    );

    expect(saved).toStrictEqual(reply);
    expect(saved.harvest.lastCompleteSuccess).toBeGreaterThan(0);
  });

  it("repeating a completed first Harvest does not claim a new check", async () => {
    const project = textProject("already-seeded");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    const reply = await withHarvestRuntime(
      stub,
      discordPage([sourceMessage("101")]),
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");

        return harvestStoredProject(runtime, project, "live");
      }
    );

    const replay = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      (runtime) =>
        harvestStoredProject(runtime, project, "live", new SimulatedClock())
    );

    expect(replay).toStrictEqual(reply);
  });
});
