import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { DiscordRateLimited } from "../../features/question-finder/services/discord/lib/errors";
import {
  Judge,
  JudgeFailed,
} from "../../features/question-finder/services/judge";
import { projectHarvestStub } from "../projectHarvest";
import { sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("Harvest generation guards", () => {
  it.each<{ phase: string; fails: boolean; ownerChange?: boolean }>([
    { phase: "acquisition", fails: false },
    { phase: "processing", fails: false },
    { phase: "acquisition", fails: true },
    { phase: "processing", fails: true },
    { phase: "processing", fails: false, ownerChange: true },
  ])(
    "discards stale $phase IO (fails=$fails, ownerChange=$ownerChange)",
    async ({ phase, fails, ownerChange = false }) => {
      const project = textProject(`stale-${phase}-${fails}-${ownerChange}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      const time = { now: 2_000_000_000_000 };
      const started = Deferred.makeUnsafe<undefined>();
      const release = Deferred.makeUnsafe<undefined>();

      const hold = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
      });

      const wire = Layer.succeed(
        Discord,
        Discord.of({
          messagesSince: () => Effect.die("legacy"),
          hasReplyFrom: () => Effect.die("legacy"),
          sourcePage: () =>
            Effect.gen(function* () {
              if (phase === "acquisition") {
                yield* hold;

                if (fails) {
                  return yield* Effect.fail(
                    new DiscordRateLimited({
                      retryAfterMs: 60_000,
                      global: true,
                    })
                  );
                }
              }

              return [sourceMessage("101")];
            }),
        })
      );

      const judge = Layer.succeed(
        Judge,
        Judge.of({
          answerable: () =>
            Effect.gen(function* () {
              if (phase === "processing") {
                yield* hold;

                if (fails) {
                  return yield* Effect.fail(
                    new JudgeFailed({ reason: "Old request failed" })
                  );
                }
              }

              return { answerable: true, reason: "test" };
            }),
        })
      );

      await withScheduledHarvest(
        stub,
        time,
        wire,
        async (scheduled, storage) => {
          await scheduled.activate(project);
          const running = scheduled.alarm(project);
          await Effect.runPromise(Deferred.await(started));

          const current = ownerChange
            ? { ...project, ownerName: "Changed owner" }
            : project;

          if (ownerChange) {
            await scheduled.read(current);
          } else {
            storage.sql.exec(
              "UPDATE harvest_cycle SET generation=generation+1 WHERE id=1"
            );
          }

          await Effect.runPromise(Deferred.succeed(release, undefined));
          await running;
          expect({
            retries: storage.sql
              .exec("SELECT * FROM harvest_retries")
              .toArray(),
            globalPause: storage.sql
              .exec<{ global_pause: number }>(
                "SELECT global_pause FROM harvest_schedule WHERE id=1"
              )
              .one().global_pause,
            failures: storage.sql
              .exec(
                "SELECT failure FROM fetch_progress WHERE failure IS NOT NULL"
              )
              .toArray(),
          }).toStrictEqual({ retries: [], globalPause: 0, failures: [] });
          const saved = await scheduled.read(current);
          expect(saved.questions).toStrictEqual([]);
          expect(saved.harvest.pendingProcessing).toBe(
            phase === "processing" ? 1 : 0
          );
          expect(
            storage.sql
              .exec<{ generation: number }>(
                "SELECT generation FROM fetch_progress WHERE stream_id='800'"
              )
              .one().generation
          ).toBeLessThan(2);
        },
        judge
      );
    }
  );
});
