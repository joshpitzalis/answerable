/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { DiscordFailed } from "../../features/question-finder/services/discord/lib/errors";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("Harvest fairness", () => {
  it("skips a deferred Channel without reversing the three-Channel turn order", async () => {
    const project = {
      ...textProject("three-channel-turns"),
      channels: [
        { id: "800", name: "first" },
        { id: "801", name: "deferred" },
        { id: "802", name: "third" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    await withHarvestRuntime(
      stub,
      discordPage([]),
      Judge.everythingAnswerable,
      (runtime) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            yield* store.reconcileConfiguration(project, "live", true, 1000);
            yield* store.activate(project, 1000);
            yield* store.beginCycle;
            expect(yield* store.claimAcquisition(project)).toMatchObject({
              channelId: "800",
            });
            yield* store.retry({
              kind: "acquisition",
              workId: "801",
              channelId: "801",
              reason: "Deferred source",
              retryAfterMs: 60_000,
            });
            expect(yield* store.claimAcquisition(project)).toMatchObject({
              channelId: "802",
            });
            expect(yield* store.claimAcquisition(project)).toMatchObject({
              channelId: "800",
            });
          })
        )
    );
  });

  it("rotates acquisition and processing so a busy Channel does not starve a small sibling", async () => {
    const project = {
      ...textProject("fair-batches"),
      channels: [
        { id: "800", name: "busy" },
        { id: "801", name: "small" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const requests: string[] = [];

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("no replies"),
        sourcePage: ({ channelId }) =>
          Effect.sync(() => {
            requests.push(channelId);

            return channelId === "800"
              ? Array.from({ length: 50 }, (_, index) =>
                  sourceMessage(String(101 + index))
                )
              : [
                  {
                    ...sourceMessage("201"),
                    channelId,
                    parentChannelId: channelId,
                  },
                ];
          }),
      })
    );

    const first = await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(first.questions).toHaveLength(20);
    expect(first.harvest.pendingProcessing).toBe(30);
    await evictDurableObject(stub);

    const second = await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(requests).toStrictEqual(["800", "801"]);
    expect(second.questions.some((row) => row.id === "201")).toBeTruthy();
    expect(second.harvest.pendingProcessing).toBe(30);
  });

  it("preserves a failed Channel's report while a sibling commits its own result", async () => {
    const project = {
      ...textProject("failed-sibling"),
      channels: [
        { id: "800", name: "unavailable" },
        { id: "801", name: "available" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("no replies"),
        sourcePage: ({ channelId }) =>
          channelId === "800"
            ? Effect.fail(new DiscordFailed({ reason: "denied" }))
            : Effect.succeed([
                {
                  ...sourceMessage("201"),
                  channelId,
                  parentChannelId: channelId,
                },
              ]),
      })
    );

    await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    const second = await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(second.questions.map((row) => row.id)).toStrictEqual(["201"]);
    expect(second.failedChannels).toStrictEqual([
      { name: "unavailable", reason: "Discord could not be read" },
    ]);
    expect(second.harvest.status).toBe("partial");
    expect(second.harvest.lastCompleteSuccess).toBeNull();
  });
});
