/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { reconciliationInterval } from "../../features/question-finder/domain/reconciliation.values";
import {
  Discord,
  DiscordFailed,
} from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { projectHarvestStub } from "../projectHarvest";
import { sourceMessage, textProject } from "./harvest.test-utils";
import {
  emptyDiscovery,
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("daily reconciliation", () => {
  it("resumes daily obligations after reconstruction, rejudges an edit once, and preserves missing recent messages", async () => {
    const project = textProject("daily-reconciliation");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    let daily = false;
    let judged = 0;
    const observed: string[] = [];

    const judge = Layer.succeed(
      Judge,
      Judge.of({
        answerable: () =>
          Effect.sync(() => {
            judged += 1;

            return { answerable: true };
          }),
      })
    );

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("legacy"),
        sourcePage: (request) =>
          Effect.sync(() => {
            if (request.reconciliation !== undefined) {
              observed.push(request.reconciliation.kind);

              return {
                reconciliation: {
                  kind: "messages" as const,
                  messages:
                    request.reconciliation.kind === "recent"
                      ? []
                      : [sourceMessage("101", "How do changed Layers work?")],
                },
              };
            }

            return (
              emptyDiscovery(request) ?? (daily ? [] : [sourceMessage("101")])
            );
          }),
      })
    );

    await withScheduledHarvest(
      stub,
      time,
      wire,
      async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        await finishTextDiscovery(scheduled, project, time);
        const initial = await scheduled.read(project);
        expect(initial.questions).toHaveLength(1);
        expect(judged).toBe(1);
        daily = true;
        time.now += reconciliationInterval;
        await scheduled.alarm(project);
        const pending = await scheduled.read(project);
        expect(pending.harvest.status).not.toBe("current");
      },
      judge
    );
    await evictDurableObject(stub);
    await withScheduledHarvest(
      stub,
      time,
      wire,
      async (scheduled) => {
        for (let batch = 0; batch < 8; batch += 1) {
          time.now += 1000;
          // oxlint-disable-next-line no-await-in-loop -- Each alarm resumes durable reconciliation work.
          await scheduled.alarm(project);
        }

        const saved = await scheduled.read(project);
        expect(saved.questions.map((row) => row.question)).toStrictEqual([
          "How do changed Layers work?",
        ]);
        expect(saved.harvest.status).toBe("current");
        expect(observed.toSorted()).toStrictEqual(["message", "recent"]);
        expect(judged).toBe(2);
        time.now += reconciliationInterval;

        for (let batch = 0; batch < 8; batch += 1) {
          time.now += 1000;
          // oxlint-disable-next-line no-await-in-loop -- A second daily pass must not rejudge unchanged content.
          await scheduled.alarm(project);
        }

        expect(judged).toBe(2);
      },
      judge
    );
  });

  it("unavailable known-message work retains questions and retries independently of the recent page", async () => {
    const project = textProject("unavailable-reconciliation");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    let daily = false;
    let recent = 0;

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("legacy"),
        sourcePage: (request) => {
          if (request.reconciliation?.kind === "message") {
            return Effect.fail(
              new DiscordFailed({ reason: "Permission denied", status: 403 })
            );
          }

          if (request.reconciliation?.kind === "recent") {
            recent += 1;

            return Effect.succeed({
              reconciliation: { kind: "messages", messages: [] },
            });
          }

          return Effect.succeed(
            emptyDiscovery(request) ?? (daily ? [] : [sourceMessage("101")])
          );
        },
      })
    );

    await withScheduledHarvest(stub, time, wire, async (scheduled) => {
      await scheduled.activate(project);
      await scheduled.alarm(project);
      await finishTextDiscovery(scheduled, project, time);
      daily = true;
      time.now += reconciliationInterval;

      for (let batch = 0; batch < 12; batch += 1) {
        // oxlint-disable-next-line no-await-in-loop -- Retries share the regular scheduler's persisted budget.
        await scheduled.alarm(project);
        time.now += 1000;
      }

      const saved = await scheduled.read(project);
      expect(saved.questions).toHaveLength(1);
      expect(saved.harvest.status).toBe("partial");
      expect(saved.failedChannels).toHaveLength(1);
      expect(recent).toBe(1);
    });
  });
});
