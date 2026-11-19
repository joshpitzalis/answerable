import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import {
  finishTextDiscovery,
  withScheduledHarvest,
} from "./scheduledHarvest.test-utils";

describe("reconciliation deadlines", () => {
  it("enqueues exactly at the daily deadline and never restarts unfinished obligations", async () => {
    const project = textProject("reconciliation-queue-deadline");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    const due = 2_000_086_400_000;
    const followingDay = 2_000_172_800_000;
    await withScheduledHarvest(
      stub,
      time,
      discordPage([sourceMessage("101"), sourceMessage("102")]),
      async (scheduled, storage) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        await finishTextDiscovery(scheduled, project, time);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const queued = () =>
          storage.sql
            .exec<{ work_id: string }>(
              "SELECT work_id FROM reconciliation_work ORDER BY work_id"
            )
            .toArray()
            .map((row) => row.work_id);

        await scheduled.runtime.runPromise(
          store.startScheduled(project, due - 1)
        );
        expect(queued()).toStrictEqual([]);
        await scheduled.runtime.runPromise(store.startScheduled(project, due));

        const turns = [
          await scheduled.runtime.runPromise(store.claimAcquisition(project)),
          await scheduled.runtime.runPromise(store.claimAcquisition(project)),
        ];

        await scheduled.runtime.runPromise(
          store.retry({
            kind: "acquisition",
            workId: "800",
            channelId: "800",
            reason: "Collection deferred",
            retryAfterMs: 60_000,
          })
        );

        const deferredTurns = [
          await scheduled.runtime.runPromise(store.claimAcquisition(project)),
          await scheduled.runtime.runPromise(store.claimAcquisition(project)),
        ];

        expect({
          queued: queued(),
          turns: turns.map((turn) => ({
            channelId: turn?.channelId,
            reconciliation: turn?.reconciliation !== undefined,
          })),
          deferredTurns: deferredTurns.map((turn) => ({
            channelId: turn?.channelId,
            reconciliation: turn?.reconciliation !== undefined,
          })),
        }).toStrictEqual({
          queued: [
            "reconcile:message:101",
            "reconcile:message:102",
            "reconcile:recent:800",
          ],
          turns: expect.arrayContaining([
            { channelId: "800", reconciliation: false },
            { channelId: "800", reconciliation: true },
          ]),
          deferredTurns: [
            { channelId: "800", reconciliation: true },
            { channelId: "800", reconciliation: true },
          ],
        });

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        const progress = await scheduled.runtime.runPromise(
          store.progress("800")
        );

        await scheduled.runtime.runPromise(
          store.ingestPage({
            messages: [],
            progress: { ...progress, generation },
            expectedGeneration: generation,
            observedAt: due,
            policyRevision: "test",
          })
        );
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            { scope: "active", threads: [], hasMore: false, isForum: false },
            due
          )
        );
        await scheduled.runtime.runPromise(
          store.saveThreadPage(
            "800",
            generation,
            { scope: "archive", threads: [], hasMore: false, isForum: false },
            due
          )
        );
        await expect(
          scheduled.runtime.runPromise(store.read(project))
        ).resolves.toMatchObject({
          harvest: { status: "working", pendingProcessing: 0 },
          failedChannels: [],
        });

        await scheduled.runtime.runPromise(
          store.saveReconciliation(
            {
              workId: "reconcile:message:101",
              channelId: "800",
              streamId: "800",
              request: { kind: "message", messageId: "101" },
            },
            generation,
            { kind: "messages", messages: [sourceMessage("101")] },
            "test",
            due
          )
        );
        await scheduled.runtime.runPromise(
          store.startScheduled(project, followingDay)
        );
        const committed = await scheduled.runtime.runPromise(store.messages);
        await scheduled.runtime.runPromise(
          store.saveReconciliation(
            {
              workId: "reconcile:message:101",
              channelId: "800",
              streamId: "800",
              request: { kind: "message", messageId: "101" },
            },
            generation,
            {
              kind: "messages",
              messages: [
                { ...sourceMessage("101"), content: "Stale response" },
              ],
            },
            "test",
            followingDay
          )
        );
        expect(queued()).toStrictEqual([
          "reconcile:message:102",
          "reconcile:recent:800",
        ]);
        expect({
          messages: await scheduled.runtime.runPromise(store.messages),
          nextDue: storage.sql
            .exec<{ next_due: number }>(
              "SELECT next_due FROM reconciliation_schedule"
            )
            .one().next_due,
        }).toStrictEqual({ messages: committed, nextDue: followingDay });
      }
    );
  });
});
