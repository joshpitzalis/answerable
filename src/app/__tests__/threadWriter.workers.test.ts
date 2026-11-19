import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { textProject, unavailableDiscord } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";
import {
  at,
  reply,
  thread,
  withTrackedThread,
} from "./threadWriter.test-utils";

describe("thread storage boundaries", () => {
  it("rejects archived discovery before an active scan establishes its range", async () => {
    const project = textProject("archive-without-active");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withScheduledHarvest(
      stub,
      { now: at },
      unavailableDiscord,
      async (scheduled, storage) => {
        await scheduled.activate(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        await expect(
          scheduled.runtime.runPromise(
            store.saveThreadPage(
              "800",
              generation,
              {
                scope: "archive",
                threads: [thread],
                hasMore: false,
                isForum: true,
              },
              at
            )
          )
        ).rejects.toBeInstanceOf(ProjectStorageError);
        expect(
          storage.sql.exec("SELECT * FROM discord_threads").toArray()
        ).toStrictEqual([]);
        expect(
          storage.sql.exec("SELECT * FROM forum_scans").toArray()
        ).toStrictEqual([]);
      }
    );
  });

  it("rejects stale discovery and thread pages without changing current obligations", async () => {
    await withTrackedThread(
      "stale-thread-writers",
      async (scheduled, storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const before = storage.sql
          .exec("SELECT * FROM discord_threads")
          .toArray();

        await expect(
          scheduled.runtime.runPromise(
            store.saveThreadPage(
              "800",
              generation - 1,
              {
                scope: "active",
                threads: [{ ...thread, id: "202", starterId: "202" }],
                hasMore: false,
                isForum: true,
              },
              at
            )
          )
        ).resolves.toBeFalsy();
        await expect(
          scheduled.runtime.runPromise(
            store.saveThreadMessages(
              thread,
              generation - 1,
              [reply("102")],
              "test",
              at
            )
          )
        ).resolves.toBeFalsy();
        expect(
          storage.sql.exec("SELECT * FROM discord_threads").toArray()
        ).toStrictEqual(before);
        await expect(
          scheduled.runtime.runPromise(store.messages)
        ).resolves.toStrictEqual([]);
      }
    );
  });

  it.each(["channelId", "parentChannelId", "threadId"])(
    "rolls back a mixed thread page with foreign %s",
    async (field) => {
      await withTrackedThread(
        `thread-writer-${field}`,
        async (scheduled, _storage, generation) => {
          const store = await scheduled.runtime.runPromise(ProjectStorage);
          await expect(
            scheduled.runtime.runPromise(
              store.saveThreadMessages(
                thread,
                generation,
                [reply("102"), { ...reply("103"), [field]: "999" }],
                "test",
                at
              )
            )
          ).rejects.toBeInstanceOf(ProjectStorageError);
          await expect(
            scheduled.runtime.runPromise(store.messages)
          ).resolves.toStrictEqual([]);
          await expect(
            scheduled.runtime.runPromise(store.progress("101"))
          ).resolves.toMatchObject({ seeded: true, completedBoundary: "0" });
        }
      );
    }
  );

  it("refuses a non-advancing page without moving its saved range", async () => {
    await withTrackedThread(
      "thread-nonprogress",
      async (scheduled, storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        storage.sql.exec(
          "UPDATE fetch_progress SET seeded=1, completed_boundary='100', upper_boundary='200', before_id='151' WHERE stream_id='101'"
        );
        await expect(
          scheduled.runtime.runPromise(
            store.saveThreadMessages(
              thread,
              generation,
              [reply("151")],
              "test",
              at
            )
          )
        ).resolves.toBeFalsy();
        await expect(
          scheduled.runtime.runPromise(store.messages)
        ).resolves.toStrictEqual([]);
        await expect(
          scheduled.runtime.runPromise(store.progress("101"))
        ).resolves.toMatchObject({
          completedBoundary: "100",
          upperBoundary: "200",
          before: "151",
        });
      }
    );
  });

  it("defers arrivals above a captured upper boundary while committing the remaining range", async () => {
    await withTrackedThread(
      "thread-captured-upper",
      async (scheduled, storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        storage.sql.exec(
          "UPDATE fetch_progress SET seeded=1, completed_boundary='100', upper_boundary='200', before_id='151' WHERE stream_id='101'"
        );
        await expect(
          scheduled.runtime.runPromise(
            store.saveThreadMessages(
              thread,
              generation,
              [reply("201"), reply("150")],
              "test",
              at
            )
          )
        ).resolves.toBeTruthy();
        const messages = await scheduled.runtime.runPromise(store.messages);
        expect(messages.map((message) => message.id)).toStrictEqual(["150"]);
        await expect(
          scheduled.runtime.runPromise(store.progress("101"))
        ).resolves.toMatchObject({
          completedBoundary: "200",
          upperBoundary: null,
          before: null,
        });
      }
    );
  });

  it("returns no forum work after discovery, starter and comments finish", async () => {
    await withTrackedThread(
      "forum-no-pending",
      async (scheduled, _storage, generation) => {
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            { scope: "archive", threads: [], hasMore: false, isForum: true },
            at
          )
        );
        await scheduled.runtime.runPromise(
          store.saveForumStarter("800", generation, reply("101"), "test", at)
        );
        await scheduled.runtime.runPromise(
          store.saveThreadMessages(thread, generation, [], "test", at)
        );
        await expect(
          scheduled.runtime.runPromise(store.forumRequest("800", generation))
        ).resolves.toBeUndefined();
      }
    );
  });
});
