import { Effect, Logger } from "effect";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { acquireStoredPage } from "../../features/question-finder/workflows/acquireStoredPage";
import { textProject } from "./harvest.test-utils";
import {
  at,
  reply,
  thread,
  withTrackedThread,
} from "./threadWriter.test-utils";

describe("reopened thread continuation", () => {
  it("does not requeue an already processed starter when its first comment page is empty", async () => {
    const project = textProject("empty-thread-context");
    await withTrackedThread(project.id, async (scheduled) => {
      const store = await scheduled.runtime.runPromise(ProjectStorage);
      const lines: string[] = [];

      const collect = acquireStoredPage(project, "test").pipe(
        Effect.provideService(
          Discord,
          Discord.of({
            messagesSince: () => Effect.die("Legacy collection must not run"),
            hasReplyFrom: () => Effect.die("No reply checks expected"),
            sourcePage: (request) => {
              if (request.forum?.kind === "archive") {
                return Effect.succeed({
                  scope: "archive",
                  threads: [],
                  hasMore: false,
                  isForum: true,
                } as const);
              }

              if (request.forum?.kind === "starter") {
                return Effect.succeed({
                  starter: { ...reply("101"), isPost: true },
                });
              }

              if (request.forum?.kind === "messages") {
                return Effect.succeed({ thread, messages: [] });
              }

              return Effect.die("Expected tracked forum work");
            },
          })
        ),
        Effect.provide(
          Logger.layer([
            Logger.make(({ message }) => {
              lines.push(String(message));
            }),
          ])
        )
      );

      await scheduled.runtime.runPromise(collect);
      await scheduled.runtime.runPromise(collect);

      const [candidate] = await scheduled.runtime.runPromise(
        store.pending(["800"])
      );

      if (candidate === undefined) {
        throw new Error("Expected starter candidate");
      }

      await expect(
        scheduled.runtime.runPromise(store.complete(candidate, null))
      ).resolves.toBeTruthy();
      await scheduled.runtime.runPromise(collect);
      await expect(
        scheduled.runtime.runPromise(store.pending(["800"]))
      ).resolves.toStrictEqual([]);
      expect(lines).toStrictEqual([
        "harvest acquisition channel=1 failed=0 pending=0",
        "harvest ingestion inserted=1 updated=0 unchanged=0",
        "harvest acquisition channel=1 failed=0 pending=1",
        "harvest ingestion inserted=0 updated=0 unchanged=0",
        "harvest acquisition channel=1 failed=0 pending=0",
      ]);
    });
  });

  it("keeps a same-generation archived tail pending until its captured range finishes", async () => {
    await withTrackedThread(
      "same-generation-archive-tail",
      async (scheduled, _storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await scheduled.runtime.runPromise(
          store.saveForumStarter("800", generation, reply("101"), "test", at)
        );
        await scheduled.runtime.runPromise(
          store.saveThreadMessages(
            thread,
            generation,
            [reply("102")],
            "test",
            at
          )
        );

        const archived = {
          ...thread,
          archived: true,
          archiveTimestamp: new Date(at).toISOString(),
        };

        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            {
              scope: "archive",
              threads: [archived],
              hasMore: false,
              isForum: true,
            },
            at
          )
        );
        await scheduled.runtime.runPromise(
          store.saveThreadMessages(
            archived,
            generation,
            Array.from({ length: 50 }, (_, index) =>
              reply(String(200 + index))
            ),
            "test",
            at
          )
        );
        await expect(
          scheduled.runtime.runPromise(store.forumRequest("800", generation))
        ).resolves.toMatchObject({
          kind: "messages",
          thread: { id: "101", archived: true },
        });
        await expect(
          scheduled.runtime.runPromise(store.progress("101"))
        ).resolves.toMatchObject({
          completedBoundary: "102",
          upperBoundary: "249",
          before: "200",
        });
        await scheduled.runtime.runPromise(
          store.saveThreadMessages(
            archived,
            generation,
            [reply("199")],
            "test",
            at
          )
        );
        await expect(
          scheduled.runtime.runPromise(store.forumRequest("800", generation))
        ).resolves.toBeUndefined();
      }
    );
  });
});
