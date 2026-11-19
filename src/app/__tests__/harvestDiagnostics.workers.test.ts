import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { Corpus } from "../../features/question-finder/services/corpus";
import {
  Discord,
  DiscordFailed,
} from "../../features/question-finder/services/discord";
import { DiscordRateLimited } from "../../features/question-finder/services/discord/lib/errors";
import {
  Judge,
  JudgeFailed,
} from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import { testClock } from "./scheduledHarvest.test-utils";

describe("durable Harvest diagnostics", () => {
  it.each([
    { failure: new DiscordFailed({ reason: "secret-token" }), delay: 1000 },
    { failure: new DiscordRateLimited({ retryAfterMs: 2500 }), delay: 2500 },
  ])(
    "attributes empty and failing sibling acquisitions without pending processing ($delay)",
    async ({ failure, delay }) => {
      const project = {
        ...textProject(`empty-failed-diagnostics-${delay}`),
        channels: [
          { id: "800", name: "secret-empty" },
          { id: "801", name: "secret-failed" },
        ],
      };

      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      const lines: string[] = [];

      await runInDurableObject(stub, async (_instance, state) => {
        const runtime = ManagedRuntime.make(
          Layer.mergeAll(
            ProjectStorage.layer(state.storage),
            Layer.succeed(
              Discord,
              Discord.of({
                messagesSince: () =>
                  Effect.die("Legacy acquisition must not run"),
                hasReplyFrom: () => Effect.die("No reply checks expected"),
                sourcePage: (request) =>
                  request.channelId === "800"
                    ? Effect.succeed([])
                    : Effect.fail(failure),
              })
            ),
            Judge.everythingAnswerable,
            Corpus.stub,
            testClock({ now: 2_000_000_000_000 }),
            Logger.layer([
              Logger.make(({ message }) => {
                lines.push(String(message));
              }),
            ])
          )
        );

        try {
          await harvestStoredProject(runtime, project, "live");
          const saved = await harvestStoredProject(runtime, project, "live");
          expect(saved).toMatchObject({
            questions: [],
            harvest: { pendingProcessing: 0, status: "partial" },
          });
          expect(lines).toStrictEqual([
            "harvest ingestion inserted=0 updated=0 unchanged=0",
            "harvest acquisition channel=1 failed=0 pending=0",
            `harvest retry kind=acquisition attempts=1 delay_ms=${delay}`,
            "harvest acquisition channel=2 failed=1 pending=0",
          ]);
          expect(lines.join("\n")).not.toMatch(
            /secret|Writer|Owner|800|801|700/u
          );
        } finally {
          await runtime.dispose();
        }
      });
    }
  );

  it("logs a bounded numeric funnel and persisted retry delay without private values", async () => {
    const project = textProject("diagnostics-secret-project");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const lines: string[] = [];
    const time = { now: 2_000_000_000_000 };

    await runInDurableObject(stub, async (_instance, state) => {
      const runtime = ManagedRuntime.make(
        Layer.mergeAll(
          ProjectStorage.layer(state.storage),
          discordPage([
            sourceMessage("101", "How can secret-content work?"),
            sourceMessage("102", "A statement"),
            sourceMessage("103", "Why fail?"),
          ]),
          Layer.succeed(
            Judge,
            Judge.of({
              answerable: (content) =>
                content === "Why fail?"
                  ? Effect.fail(new JudgeFailed({ reason: "secret-token" }))
                  : Effect.succeed({ answerable: true }),
            })
          ),
          Corpus.stub,
          testClock(time),
          Logger.layer([
            Logger.make(({ message }) => {
              lines.push(String(message));
            }),
          ])
        )
      );

      try {
        const saved = await harvestStoredProject(runtime, project, "live");
        expect(saved.questions.map((row) => row.id)).toStrictEqual(["101"]);
        expect(lines).toStrictEqual([
          "harvest ingestion inserted=3 updated=0 unchanged=0",
          "harvest acquisition channel=1 failed=0 pending=3",
          "harvest retry kind=processing attempts=1 delay_ms=1000",
          "harvest channel=1 evaluated=3 questions=2 unanswered=2 kept=1 failed=1 pending=1",
        ]);
        expect(lines.join("\n")).not.toMatch(
          /secret|Writer|Owner|help|800|700/u
        );
      } finally {
        await runtime.dispose();
      }
    });
  });
});
