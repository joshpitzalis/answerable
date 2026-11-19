import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { sourceMessage, textProject } from "./harvest.test-utils";

describe("reconciled thread metadata", () => {
  it("retains thread associations and forum identity while reporting exact ingestion counts", async () => {
    const project = textProject("reconciled-metadata");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const lines: string[] = [];

    const thread = {
      id: "101",
      parentChannelId: "800",
      starterId: "101",
      title: "Forum question",
      archived: false,
      archiveTimestamp: "2026-11-01T00:00:00Z",
      isPost: true,
    };

    const starter = {
      ...sourceMessage("101"),
      channelId: "101",
      threadId: "101",
      isPost: true,
      url: "https://discord.com/channels/700/101/101",
    };

    const reply = {
      ...sourceMessage("102", "Saved reply"),
      channelId: "101",
      threadId: "101",
      url: "https://discord.com/channels/700/101/102",
    };

    await runInDurableObject(stub, async (_instance, state) => {
      const runtime = ManagedRuntime.make(
        Layer.merge(
          ProjectStorage.layer(state.storage),
          Logger.layer([
            Logger.make(({ message }) => {
              lines.push(String(message));
            }),
          ])
        )
      );

      try {
        await runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;
            yield* store.reconcileConfiguration(project, "live", true, 1000);
            yield* store.activate(project, 1000);
            yield* store.beginCycle;
            const turn = yield* store.claimAcquisition(project);

            if (turn === null) {
              throw new Error("Initial collection must be available");
            }

            yield* store.saveThreadPage(
              "800",
              turn.generation,
              { scope: "active", threads: [thread], hasMore: false },
              1000
            );
            yield* store.saveForumStarter(
              "800",
              turn.generation,
              starter,
              "test",
              1000
            );
            expect(lines).toStrictEqual([
              "harvest ingestion inserted=1 updated=0 unchanged=0",
            ]);
            yield* store.saveThreadMessages(
              thread,
              turn.generation,
              [reply],
              "test",
              1000
            );
            state.storage.sql.exec(
              "INSERT INTO reconciliation_work (work_id,channel_id,stream_id,kind) VALUES ('reconcile:recent:101','800','101','recent')"
            );
            lines.length = 0;
            yield* store.saveReconciliation(
              {
                workId: "reconcile:recent:101",
                channelId: "800",
                streamId: "101",
                request: { kind: "recent" },
              },
              turn.generation,
              {
                kind: "messages",
                messages: [
                  {
                    ...starter,
                    content: "Updated starter?",
                    threadId: null,
                    isPost: false,
                  },
                  { ...reply, threadId: null },
                  {
                    ...reply,
                    id: "103",
                    content: "New reply",
                    url: "https://discord.com/channels/700/101/103",
                  },
                ],
              },
              "test",
              2000
            );
            expect(yield* store.messages).toMatchObject([
              { id: "101", threadId: "101", isPost: true, sourceRevision: 2 },
              { id: "102", threadId: "101", isPost: false, sourceRevision: 1 },
              { id: "103", threadId: "101", isPost: false, sourceRevision: 1 },
            ]);
            expect(lines).toStrictEqual([
              "harvest ingestion inserted=1 updated=1 unchanged=1",
            ]);
            yield* store.saveThreadPage(
              "800",
              turn.generation,
              { scope: "archive", threads: [], hasMore: false },
              2000
            );
            state.storage.sql.exec(
              "INSERT INTO reconciliation_work (work_id,channel_id,stream_id,kind) VALUES ('reconcile:thread:101','800','101','thread')"
            );
            yield* store.saveReconciliation(
              {
                workId: "reconcile:thread:101",
                channelId: "800",
                streamId: "101",
                request: { kind: "thread" },
              },
              turn.generation,
              {
                kind: "thread",
                thread: {
                  ...thread,
                  title: "Updated forum title",
                  archived: true,
                  archiveTimestamp: "2026-11-02T00:00:00Z",
                },
              },
              "test",
              3000
            );
            expect(
              yield* store.forumRequest("800", turn.generation)
            ).toMatchObject({
              kind: "messages",
              thread: {
                id: "101",
                title: "Updated forum title",
                archived: true,
                archiveTimestamp: "2026-11-02T00:00:00Z",
              },
            });
          })
        );
      } finally {
        await runtime.dispose();
      }
    });
  });
});
