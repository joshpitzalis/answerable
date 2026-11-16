import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { DiscordRateLimited } from "../../features/question-finder/services/discord/lib/errors";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("persisted Discord pause scope", () => {
  it.each([false, true])(
    "global=%s controls sibling eligibility without pausing another Project",
    async (global) => {
      const project = {
        ...textProject(`pause-${global}`),
        channels: [
          { id: "800", name: "first" },
          { id: "801", name: "second" },
        ],
      };

      const other = textProject(`independent-${global}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

      const independent = projectHarvestStub(
        env.PROJECT_HARVEST,
        other,
        "live"
      );

      const time = { now: 2_000_000_000_000 };
      const calls: string[] = [];

      const wire = Layer.succeed(
        Discord,
        Discord.of({
          messagesSince: () => Effect.die("legacy"),
          hasReplyFrom: () => Effect.die("legacy"),
          sourcePage: (request) =>
            Effect.suspend(() => {
              calls.push(request.channelId);

              return request.channelId === "800"
                ? Effect.fail(
                    new DiscordRateLimited({ retryAfterMs: 5000, global })
                  )
                : Effect.succeed([]);
            }),
        })
      );

      await withScheduledHarvest(stub, time, wire, async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        const saved = await scheduled.read(project);
        expect(saved.harvest.nextEligibleAt).toBe(
          time.now + (global ? 5000 : 1000)
        );
      });
      await evictDurableObject(stub);
      time.now += 1000;
      await withScheduledHarvest(stub, time, wire, async (scheduled) => {
        await scheduled.alarm(project);
        expect(calls).toStrictEqual(global ? ["800"] : ["800", "801"]);
      });
      await withScheduledHarvest(
        independent,
        time,
        discordPage([]),
        async (scheduled) => {
          await scheduled.activate(other);
          await scheduled.alarm(other);
          const saved = await scheduled.read(other);
          expect(saved.harvest.status).toBe("current");
        }
      );
      time.now += 4000;
      await withScheduledHarvest(stub, time, wire, async (scheduled) => {
        await scheduled.alarm(project);
        expect(calls).toContain("801");
      });
    }
  );
});
