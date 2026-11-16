/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { SimulatedClock } from "xstate";

import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  unavailableDiscord,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("bounded Harvest deadlines", () => {
  it.each(["headers", "body"])(
    "aborts unfinished Discord %s at twenty seconds without advancing persisted progress",
    async (phase) => {
      const project = textProject(`deadline-wire-${phase}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

      const started = Effect.runSync(
        Deferred.make<AbortSignal | null | undefined>()
      );

      const paths: string[] = [];

      const fetch: typeof globalThis.fetch = (input, init) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);

        if (path.endsWith("/applications/@me")) {
          return Promise.resolve(
            Response.json({ bot: { id: "600" }, flags: 262_144 })
          );
        }

        if (path.endsWith("/channels/800")) {
          return Promise.resolve(
            Response.json({
              id: "800",
              guild_id: "700",
              type: 0,
              permission_overwrites: [],
            })
          );
        }

        if (path.endsWith("/guilds/700")) {
          return Promise.resolve(
            Response.json({
              owner_id: "500",
              roles: [{ id: "700", permissions: "66560" }],
            })
          );
        }

        if (path.endsWith("/members/600")) {
          return Promise.resolve(Response.json({ roles: [] }));
        }

        if (phase === "body") {
          return Promise.resolve(
            new Response(
              new ReadableStream(
                {
                  start(controller) {
                    init?.signal?.addEventListener(
                      "abort",
                      () => controller.error(new Error("aborted")),
                      { once: true }
                    );
                  },
                  pull() {
                    Effect.runSync(Deferred.succeed(started, init?.signal));
                  },
                },
                { highWaterMark: 0 }
              )
            )
          );
        }

        Effect.runSync(Deferred.succeed(started, init?.signal));

        return Effect.runPromise(Effect.never, {
          signal: init?.signal ?? undefined,
        });
      };

      const clock = new SimulatedClock();
      await withHarvestRuntime(
        stub,
        Discord.layer("invented", fetch),
        Judge.everythingAnswerable,
        async (runtime) => {
          const pending = harvestStoredProject(runtime, project, "live", clock);
          const signal = await Effect.runPromise(Deferred.await(started));
          clock.increment(20_000);
          const reply = await pending;
          expect(signal?.aborted).toBeTruthy();
          expect(paths).toHaveLength(5);
          expect(reply.harvest).toMatchObject({
            status: "working",
            lastCompleteSuccess: null,
          });
          await expect(
            runtime.runPromise(ProjectStorage.use((store) => store.messages))
          ).resolves.toStrictEqual([]);
        }
      );
      await evictDurableObject(stub);

      const recovered = await withHarvestRuntime(
        stub,
        discordPage([sourceMessage("101")]),
        Judge.everythingAnswerable,
        (runtime) => harvestStoredProject(runtime, project, "live")
      );

      expect(recovered.questions.map((row) => row.id)).toStrictEqual(["101"]);
    }
  );

  it("bounds concurrent judgments, aborts them, and resumes twenty saved candidates without Discord", async () => {
    const project = textProject("deadline-judge");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const fourStarted = Effect.runSync(Deferred.make<undefined>());
    let active = 0;
    let maxActive = 0;
    let aborted = 0;

    const judge = Layer.succeed(
      Judge,
      Judge.of({
        answerable: () =>
          Effect.sync(() => {
            active += 1;
            maxActive = Math.max(maxActive, active);

            if (active === 4) {
              Effect.runSync(Deferred.succeed(fourStarted, undefined));
            }
          }).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                active -= 1;
                aborted += 1;
              })
            )
          ),
      })
    );

    const clock = new SimulatedClock();

    const acquisition = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("no replies"),
        messagePage: () =>
          Effect.sync(() => {
            clock.increment(8000);

            return Array.from({ length: 50 }, (_, n) =>
              sourceMessage(String(n + 101))
            );
          }),
      })
    );

    await withHarvestRuntime(stub, acquisition, judge, async (runtime) => {
      const pending = harvestStoredProject(runtime, project, "live", clock);
      await Effect.runPromise(Deferred.await(fourStarted));
      clock.increment(12_000);
      const reply = await pending;
      expect(reply.harvest.pendingProcessing).toBe(50);
      expect(maxActive).toBe(4);
      expect(aborted).toBe(4);
    });
    await evictDurableObject(stub);

    const recovered = await withHarvestRuntime(
      stub,
      unavailableDiscord,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );

    expect(recovered.questions).toHaveLength(20);
    expect(recovered.harvest.pendingProcessing).toBe(30);
  });
});
