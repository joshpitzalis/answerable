/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { compareSnowflakes } from "../../features/question-finder/domain/harvest.values";
import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import {
  harvestStoredProject,
  requestStoredHarvest,
} from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import {
  sourceMessage,
  textProject,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("resumable Harvest pages", () => {
  it("rolls back a failed continuation page without losing the previously committed page", async () => {
    const project = textProject("continuation-rollback");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    let first = true;
    const cursors: (string | null)[] = [];

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy"),
        hasReplyFrom: () => Effect.die("no replies"),
        messagePage: ({ before }) =>
          Effect.sync(() => {
            cursors.push(before);

            if (first) {
              first = false;

              return [sourceMessage("101", "content")];
            }

            return Array.from({ length: 50 }, (_, index) =>
              sourceMessage(
                String((before === null ? 252 : 202) - index),
                "content"
              )
            );
          }),
      })
    );

    await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        await runtime.runPromise(requestStoredHarvest(project));
        await harvestStoredProject(runtime, project, "live");
      }
    );
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_page BEFORE INSERT ON messages WHEN NEW.id='200' BEGIN SELECT RAISE(ABORT, 'injected'); END"
      );
    });
    await expect(
      withHarvestRuntime(stub, wire, Judge.everythingAnswerable, (runtime) =>
        harvestStoredProject(runtime, project, "live")
      )
    ).rejects.toBeInstanceOf(ProjectStorageError);
    await evictDurableObject(stub);
    await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      async (runtime) => {
        const progress = await runtime.runPromise(
          ProjectStorage.use((store) => store.progress("800"))
        );
        expect(progress).toMatchObject({
          before: "203",
          upperBoundary: "252",
          completedBoundary: "101",
        });
        await expect(
          runtime.runPromise(ProjectStorage.use((store) => store.messages))
        ).resolves.toHaveLength(51);
      }
    );
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("DROP TRIGGER fail_page");
    });
    await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      (runtime) => harvestStoredProject(runtime, project, "live")
    );
    expect(cursors).toStrictEqual([null, null, "203", "203"]);
  });

  it("resumes a large captured range after eviction and leaves new arrivals for the next Harvest", async () => {
    const project = textProject("backward-range");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    let messages = [sourceMessage("101", "saved content")];
    const requests: (string | null)[] = [];

    const wire = Layer.succeed(
      Discord,
      Discord.of({
        messagesSince: () => Effect.die("legacy path"),
        hasReplyFrom: () => Effect.die("no threads"),
        messagePage: (request) =>
          Effect.sync(() => {
            requests.push(request.before);

            return messages
              .filter(
                (message) =>
                  request.before === null ||
                  compareSnowflakes(message.id, request.before) < 0
              )
              .toSorted((a, b) => compareSnowflakes(b.id, a.id))
              .slice(0, request.limit);
          }),
      })
    );

    await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        messages = Array.from({ length: 152 }, (_, index) =>
          sourceMessage(String(101 + index), "saved content")
        );
        await runtime.runPromise(requestStoredHarvest(project));
        const reply = await harvestStoredProject(runtime, project, "live");
        expect(reply.harvest.pendingProcessing).toBe(30);

        const progress = await runtime.runPromise(
          ProjectStorage.use((store) => store.progress("800"))
        );

        expect(progress).toMatchObject({
          completedBoundary: "101",
          upperBoundary: "252",
          before: "203",
        });
      }
    );
    await evictDurableObject(stub);
    messages.push(sourceMessage("300", "new arrival"));
    await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      async (runtime) => {
        for (let batch = 0; batch < 10; batch += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Each batch resumes durable state committed by its predecessor.
          const reply = await harvestStoredProject(runtime, project, "live");

          if (reply.harvest.status === "current") {
            break;
          }
        }

        const stored = await runtime.runPromise(
          ProjectStorage.use((store) => store.messages)
        );

        expect(stored).toHaveLength(152);
        expect(stored.some((message) => message.id === "300")).toBeFalsy();
        expect(requests).toStrictEqual([null, null, "203", "153", "103"]);
        await runtime.runPromise(requestStoredHarvest(project));
        await harvestStoredProject(runtime, project, "live");

        const after = await runtime.runPromise(
          ProjectStorage.use((store) => store.messages)
        );

        expect(after).toHaveLength(153);
        expect(after.at(-1)?.id).toBe("300");
      }
    );
  });
});
