import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { projectHarvestStub } from "../projectHarvest";
import { sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("Harvest generation guards", () => {
  it.each(["acquisition", "processing"])(
    "discards an old %s result after the generation changes during IO",
    async (phase) => {
      const project = textProject(`stale-${phase}`);
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
          messagePage: () =>
            Effect.gen(function* () {
              if (phase === "acquisition") {
                yield* hold;
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
          storage.sql.exec(
            "UPDATE harvest_cycle SET generation=generation+1 WHERE id=1"
          );
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await running;
          const saved = await scheduled.read(project);
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
