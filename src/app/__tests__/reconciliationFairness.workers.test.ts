import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { acquireStoredPage } from "../../features/question-finder/workflows/acquireStoredPage";
import { textProject } from "./harvest.test-utils";
import { at, thread, withTrackedThread } from "./threadWriter.test-utils";

describe("reconciliation and pending thread fairness", () => {
  it("does not consume a pending thread turn while performing reconciliation", async () => {
    const project = textProject("reconciliation-thread-turn");
    await withTrackedThread(
      project.id,
      async (scheduled, storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            {
              scope: "archive",
              threads: [
                {
                  ...thread,
                  id: "102",
                  starterId: "102",
                  archived: true,
                  archiveTimestamp: new Date(at).toISOString(),
                },
              ],
              hasMore: false,
            },
            at
          )
        );
        await scheduled.runtime.runPromise(store.claimAcquisition(project));
        await expect(
          scheduled.runtime.runPromise(store.forumRequest("800", generation))
        ).resolves.toMatchObject({ kind: "starter", thread: { id: "101" } });
        storage.sql.exec(
          "INSERT INTO reconciliation_work(work_id,channel_id,stream_id,kind) VALUES ('reconcile:recent:800','800','800','recent')"
        );
        await scheduled.runtime.runPromise(
          acquireStoredPage(project, "test").pipe(
            Effect.provide(
              Layer.succeed(
                Discord,
                Discord.of({
                  messagesSince: () =>
                    Effect.die("Legacy collection must not run"),
                  hasReplyFrom: () => Effect.die("No reply checks expected"),
                  sourcePage: (request) =>
                    request.reconciliation?.kind === "recent"
                      ? Effect.succeed({
                          reconciliation: { kind: "messages", messages: [] },
                        })
                      : Effect.die("Expected the queued reconciliation turn"),
                })
              )
            )
          )
        );
        await expect(
          scheduled.runtime.runPromise(store.forumRequest("800", generation))
        ).resolves.toMatchObject({ kind: "starter", thread: { id: "102" } });
      }
    );
  });
});
