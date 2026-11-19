import { describe, expect, it } from "vitest";

import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import {
  at,
  reply,
  thread,
  withTrackedThread,
} from "./threadWriter.test-utils";

describe("forum storage boundaries", () => {
  it("keeps parent progress incomplete when content finishes before archives", async () => {
    await withTrackedThread(
      "unfinished-archive-progress",
      async (scheduled, _storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await scheduled.runtime.runPromise(
          store.saveForumStarter("800", generation, reply("101"), "test", at)
        );
        await scheduled.runtime.runPromise(
          store.saveThreadMessages(thread, generation, [], "test", at)
        );
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toMatchObject({ generation: 0 });
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            { scope: "archive", threads: [], hasMore: false, isForum: true },
            at
          )
        );
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toMatchObject({ generation });
      }
    );
  });

  it("advances parent progress only after discovery and thread content finish", async () => {
    await withTrackedThread(
      "unfinished-forum-progress",
      async (scheduled, _storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toMatchObject({ generation: 0 });
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            { scope: "archive", threads: [], hasMore: false, isForum: true },
            at
          )
        );
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toMatchObject({ generation: 0 });
        await scheduled.runtime.runPromise(
          store.saveForumStarter("800", generation, reply("101"), "test", at)
        );
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toMatchObject({ generation: 0 });
        await scheduled.runtime.runPromise(
          store.saveThreadMessages(thread, generation, [], "test", at)
        );
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toMatchObject({ generation });
      }
    );
  });

  it.each([
    { archived: true, isPost: true },
    { archived: false, isPost: false },
  ])(
    "preserves thread kind and archive metadata: %o",
    async ({ archived, isPost }) => {
      const savedThread = {
        ...thread,
        archived,
        isPost,
        archiveTimestamp: new Date(at).toISOString(),
      };

      await withTrackedThread(
        `forum-metadata-${archived}-${isPost}`,
        async (scheduled, _storage, generation) => {
          const store = await scheduled.runtime.runPromise(ProjectStorage);
          await scheduled.runtime.runPromise(
            store.saveThreadPage(
              "800",
              generation,
              {
                scope: "active",
                threads: [{ ...savedThread, archived: false }],
                hasMore: false,
                isForum: isPost,
              },
              at
            )
          );
          await scheduled.runtime.runPromise(
            store.saveThreadPage(
              "800",
              generation,
              {
                scope: "archive",
                threads: archived ? [savedThread] : [],
                hasMore: false,
                isForum: isPost,
              },
              at
            )
          );
          await expect(
            scheduled.runtime.runPromise(store.forumRequest("800", generation))
          ).resolves.toMatchObject({
            kind: isPost ? "starter" : "messages",
            thread: { id: "101", archived, isPost },
          });
        },
        { ...savedThread, archived: false }
      );
    }
  );

  it("ignores a stale starter result without clearing its obligation", async () => {
    await withTrackedThread(
      "stale-forum-starter",
      async (scheduled, storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await scheduled.runtime.runPromise(
          store.saveForumStarter(
            "800",
            generation - 1,
            reply("101"),
            "test",
            at
          )
        );
        await expect(
          scheduled.runtime.runPromise(store.messages)
        ).resolves.toStrictEqual([]);
        expect(
          storage.sql
            .exec<{ starter_pending: number }>(
              "SELECT starter_pending FROM discord_threads WHERE id='101'"
            )
            .one().starter_pending
        ).toBe(1);
      }
    );
  });

  it.each(["channelId", "threadId"])(
    "refuses a starter with foreign %s without committing content",
    async (field) => {
      await withTrackedThread(
        `foreign-starter-${field}`,
        async (scheduled, storage, generation) => {
          const store = await scheduled.runtime.runPromise(ProjectStorage);
          await expect(
            scheduled.runtime.runPromise(
              store.saveForumStarter(
                "800",
                generation,
                { ...reply("101"), [field]: "999" },
                "test",
                at
              )
            )
          ).rejects.toBeInstanceOf(ProjectStorageError);
          await expect(
            scheduled.runtime.runPromise(store.messages)
          ).resolves.toStrictEqual([]);
          expect(
            storage.sql
              .exec<{ starter_pending: number }>(
                "SELECT starter_pending FROM discord_threads WHERE id='101'"
              )
              .one().starter_pending
          ).toBe(1);
        }
      );
    }
  );
});
