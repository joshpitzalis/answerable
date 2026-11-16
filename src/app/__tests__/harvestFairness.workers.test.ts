/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { DiscordFailed } from "../../features/question-finder/services/discord/lib/errors";
import { Judge } from "../../features/question-finder/services/judge";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import {
  sourceMessage,
  textProject,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("Harvest fairness", () => {
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
