/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { processingPolicy } from "../../features/question-finder/domain/values/harvest.values";
import type { ReconciliationWork } from "../../features/question-finder/domain/values/reconciliation.values";
import { Discord } from "../../features/question-finder/services/discord";
import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { forumThread, forumWire } from "./forum.test-utils";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import {
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

const queueMessage = (
  storage: DurableObjectStorage,
  messageId: string,
  streamId = "800"
): ReconciliationWork => {
  const workId = `reconcile:message:${messageId}`;
  storage.sql.exec(
    "INSERT INTO reconciliation_work (work_id,channel_id,stream_id,kind,message_id) VALUES (?,'800',?,'message',?)",
    workId,
    streamId,
    messageId
  );

  return {
    workId,
    channelId: "800",
    streamId,
    request: { kind: "message", messageId },
  };
};

describe("reconciliation commits", () => {
  it("rolls back question, counts, tombstone and work together, then applies duplicate deletion idempotently", async () => {
    const project = textProject("atomic-deletion");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    await withScheduledHarvest(
      stub,
      time,
      discordPage([sourceMessage("101")]),
      async (scheduled, storage) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        await finishTextDiscovery(scheduled, project, time);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        const work = queueMessage(storage, "101");
        await scheduled.runtime.runPromise(
          store.saveReconciliation(
            work,
            generation + 1,
            { kind: "deleted", messageId: "101" },
            processingPolicy("live"),
            time.now
          )
        );
        const stale = await scheduled.read(project);
        expect(stale.questions).toHaveLength(1);
        storage.sql.exec(
          "CREATE TRIGGER fail_reconciliation BEFORE DELETE ON questions BEGIN SELECT RAISE(ABORT,'injected commit failure'); END"
        );

        const deletion = () =>
          scheduled.runtime.runPromise(
            store.saveReconciliation(
              work,
              generation,
              { kind: "deleted", messageId: "101" },
              processingPolicy("live"),
              time.now
            )
          );

        await expect(deletion()).rejects.toBeInstanceOf(ProjectStorageError);
        const unchanged = await scheduled.read(project);
        const retained = await scheduled.runtime.runPromise(store.messages);
        expect({
          questionIds: unchanged.questions.map((question) => question.id),
          responses: unchanged.contributorStats?.topContributors[0]?.responses,
          deletedAt: retained[0]?.deletedAt,
          pending: storage.sql
            .exec("SELECT 1 FROM reconciliation_work")
            .toArray().length,
        }).toStrictEqual({
          questionIds: ["101"],
          responses: 1,
          deletedAt: null,
          pending: 1,
        });
        storage.sql.exec("DROP TRIGGER fail_reconciliation");
        await deletion();
        queueMessage(storage, "101");
        await deletion();
        const deleted = await scheduled.read(project);
        const tombstones = await scheduled.runtime.runPromise(store.messages);
        expect({
          questions: deleted.questions,
          counts: deleted.contributorStats,
          sourceRevision: tombstones[0]?.sourceRevision,
          deletedAt: tombstones[0]?.deletedAt,
          pending: storage.sql
            .exec("SELECT 1 FROM reconciliation_work")
            .toArray().length,
        }).toStrictEqual({
          questions: [],
          counts: null,
          sourceRevision: 2,
          deletedAt: time.now,
          pending: 0,
        });
      }
    );
  });

  it("reply edits and tombstones invalidate the starter's retained context in the same commit", async () => {
    const project = textProject("reconciled-reply-context");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    const wire = forumWire();
    wire.state.active = [forumThread("101")];
    wire.state.messages.set("101", [
      {
        id: "102",
        channel_id: "101",
        content: "First reply",
        timestamp: "2026-11-01T00:00:00Z",
        author: { id: "901", username: "Other" },
      },
    ]);
    await withScheduledHarvest(
      stub,
      time,
      Discord.layer("invented", wire.fetch),
      async (scheduled, storage) => {
        await scheduled.activate(project);

        for (let batch = 0; batch < 8; batch += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Complete initial forum discovery and retained replies.
          await scheduled.alarm(project);
          time.now += 1000;
        }

        const initial = await scheduled.read(project);
        expect(initial.questions).toHaveLength(1);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        const work = queueMessage(storage, "102", "101");
        await scheduled.runtime.runPromise(
          store.saveReconciliation(
            work,
            generation,
            {
              kind: "messages",
              messages: [
                {
                  ...sourceMessage("102", "Edited reply"),
                  channelId: "101",
                  threadId: "101",
                  authorId: "901",
                  authorName: "Other",
                },
              ],
            },
            processingPolicy("live"),
            time.now
          )
        );

        const [edited] = await scheduled.runtime.runPromise(
          store.pending(["800"])
        );

        expect(edited).toMatchObject({
          message: { id: "101", sourceRevision: 1 },
          contextRevision: expect.stringContaining("Edited reply"),
        });
        queueMessage(storage, "102", "101");
        await scheduled.runtime.runPromise(
          store.saveReconciliation(
            work,
            generation,
            { kind: "deleted", messageId: "102" },
            processingPolicy("live"),
            time.now
          )
        );

        const [deleted] = await scheduled.runtime.runPromise(
          store.pending(["800"])
        );

        const saved = await scheduled.read(project);
        expect({
          replyCount: deleted?.replyCount,
          contextChanged: deleted?.contextRevision !== edited?.contextRevision,
          contributors: saved.contributorStats?.topContributors.length,
        }).toStrictEqual({
          replyCount: 0,
          contextChanged: true,
          contributors: 1,
        });

        if (edited === undefined) {
          throw new Error("Expected edited starter candidate");
        }

        await expect(
          scheduled.runtime.runPromise(store.complete(edited, null))
        ).resolves.toBeFalsy();
      }
    );
  });
});
