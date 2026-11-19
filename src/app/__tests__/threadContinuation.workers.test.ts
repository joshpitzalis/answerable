import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import {
  at,
  reply,
  thread,
  withTrackedThread,
} from "./threadWriter.test-utils";

describe("reopened thread continuation", () => {
  it("does not requeue an already processed starter when its first comment page is empty", async () => {
    await withTrackedThread(
      "empty-thread-context",
      async (scheduled, _storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await scheduled.runtime.runPromise(
          store.saveForumStarter(
            "800",
            generation,
            { ...reply("101"), isPost: true },
            "test",
            at
          )
        );

        const [candidate] = await scheduled.runtime.runPromise(
          store.pending(["800"])
        );

        if (candidate === undefined) {
          throw new Error("Expected starter candidate");
        }

        await expect(
          scheduled.runtime.runPromise(store.complete(candidate, null))
        ).resolves.toBeTruthy();
        await scheduled.runtime.runPromise(
          store.saveThreadMessages(thread, generation, [], "test", at)
        );
        await expect(
          scheduled.runtime.runPromise(store.pending(["800"]))
        ).resolves.toStrictEqual([]);
      }
    );
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
