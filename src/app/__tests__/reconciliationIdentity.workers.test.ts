import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type {
  ReconciliationWork,
  ReconciliationRequest,
  ReconciliationResult,
} from "../../features/question-finder/domain/values/reconciliation.values";
import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

const at = 2_000_000_000_000;

const queue = (
  storage: DurableObjectStorage,
  streamId: string
): ReconciliationWork => {
  storage.sql.exec(
    "INSERT INTO reconciliation_work(work_id,channel_id,stream_id,kind,message_id) VALUES ('identity-check','800',?,'message','101')",
    streamId
  );

  return {
    workId: "identity-check",
    channelId: "800",
    streamId,
    request: { kind: "message", messageId: "101" },
  };
};

describe("reconciliation identity", () => {
  const metadata = {
    id: "800",
    starterId: "800",
    parentChannelId: "800",
    title: "Thread",
    archived: false,
    archiveTimestamp: "2026-11-01T00:00:00Z",
    isPost: true,
  };

  it.each<{
    name: string;
    request: ReconciliationRequest;
    result: ReconciliationResult;
  }>([
    {
      name: "wrong deleted ID",
      request: { kind: "message", messageId: "101" },
      result: { kind: "deleted", messageId: "102" },
    },
    {
      name: "deletion for recent work",
      request: { kind: "recent" },
      result: { kind: "deleted", messageId: "101" },
    },
    {
      name: "metadata for message work",
      request: { kind: "message", messageId: "101" },
      result: { kind: "thread", thread: metadata },
    },
    {
      name: "foreign thread ID",
      request: { kind: "thread" },
      result: { kind: "thread", thread: { ...metadata, id: "999" } },
    },
    {
      name: "foreign thread parent",
      request: { kind: "thread" },
      result: {
        kind: "thread",
        thread: { ...metadata, parentChannelId: "999" },
      },
    },
    {
      name: "messages for metadata work",
      request: { kind: "thread" },
      result: { kind: "messages", messages: [] },
    },
  ])(
    "retains content and queued work after $name",
    async ({ name, request, result }) => {
      const project = textProject(`reconciliation-kind-${name}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      await withScheduledHarvest(
        stub,
        { now: at },
        discordPage([sourceMessage("101")]),
        async (scheduled, storage) => {
          await scheduled.activate(project);
          await scheduled.alarm(project);
          const store = await scheduled.runtime.runPromise(ProjectStorage);
          const before = await scheduled.runtime.runPromise(store.messages);

          const { generation } = storage.sql
            .exec<{ generation: number }>(
              "SELECT generation FROM harvest_cycle"
            )
            .one();

          const work = { ...queue(storage, "800"), request };
          await expect(
            scheduled.runtime.runPromise(
              store.saveReconciliation(work, generation, result, "test", at)
            )
          ).rejects.toBeInstanceOf(ProjectStorageError);
          await expect(
            scheduled.runtime.runPromise(store.messages)
          ).resolves.toStrictEqual(before);
          expect(
            storage.sql
              .exec(
                "SELECT work_id FROM reconciliation_work WHERE work_id='identity-check'"
              )
              .toArray()
          ).toStrictEqual([{ work_id: "identity-check" }]);
        }
      );
    }
  );

  it.each(["id", "channelId", "parentChannelId"])(
    "rolls back a mixed reconciliation response with foreign %s",
    async (field) => {
      const project = textProject(`reconciliation-identity-${field}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
      await withScheduledHarvest(
        stub,
        { now: at },
        discordPage([sourceMessage("101")]),
        async (scheduled, storage) => {
          await scheduled.activate(project);
          await scheduled.alarm(project);
          const store = await scheduled.runtime.runPromise(ProjectStorage);
          const before = await scheduled.runtime.runPromise(store.messages);

          const { generation } = storage.sql
            .exec<{ generation: number }>(
              "SELECT generation FROM harvest_cycle"
            )
            .one();

          const work = queue(storage, "800");
          await expect(
            scheduled.runtime.runPromise(
              store.saveReconciliation(
                work,
                generation,
                {
                  kind: "messages",
                  messages: [
                    sourceMessage("101", "Changed?"),
                    { ...sourceMessage("101"), [field]: "999" },
                  ],
                },
                "test",
                at
              )
            )
          ).rejects.toBeInstanceOf(ProjectStorageError);
          await expect(
            scheduled.runtime.runPromise(store.messages)
          ).resolves.toStrictEqual(before);
          expect(
            storage.sql
              .exec(
                "SELECT work_id FROM reconciliation_work WHERE work_id='identity-check'"
              )
              .toArray()
          ).toStrictEqual([{ work_id: "identity-check" }]);
        }
      );
    }
  );

  it("does not replace a text thread's original parent message with its system starter", async () => {
    const project = textProject("text-starter-reconciliation");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    await withScheduledHarvest(
      stub,
      { now: at },
      discordPage([sourceMessage("101")]),
      async (scheduled, storage) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            {
              scope: "active",
              isForum: false,
              hasMore: false,
              threads: [
                {
                  id: "101",
                  starterId: "101",
                  parentChannelId: "800",
                  title: "Text thread",
                  archived: false,
                  archiveTimestamp: "2026-11-01T00:00:00Z",
                  isPost: false,
                },
              ],
            },
            at
          )
        );
        const before = await scheduled.runtime.runPromise(store.messages);
        const work = queue(storage, "101");
        expect(before).toMatchObject([
          { id: "101", channelId: "800", threadId: "101" },
        ]);
        await scheduled.runtime.runPromise(
          store.saveReconciliation(
            work,
            generation,
            {
              kind: "messages",
              messages: [
                {
                  ...sourceMessage("101", "System starter"),
                  channelId: "101",
                  threadId: "101",
                },
              ],
            },
            "test",
            at
          )
        );
        await expect(
          scheduled.runtime.runPromise(store.messages)
        ).resolves.toStrictEqual(before);
        expect(
          storage.sql
            .exec(
              "SELECT work_id FROM reconciliation_work WHERE work_id='identity-check'"
            )
            .toArray()
        ).toStrictEqual([]);
      }
    );
  });
});
