import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { processingPolicy } from "../../features/question-finder/domain/harvest.values";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("re-observed deleted content", () => {
  it("treats identical content after a tombstone as a new revision requiring processing", async () => {
    const project = textProject("tombstone-revival");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const at = 2_000_000_000_000;
    const message = sourceMessage("101");
    await withScheduledHarvest(
      stub,
      { now: at },
      discordPage([message]),
      async (scheduled, storage) => {
        await scheduled.activate(project);
        await scheduled.alarm(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        storage.sql.exec(
          "INSERT INTO reconciliation_work(work_id,channel_id,stream_id,kind,message_id) VALUES ('revival','800','800','message','101')"
        );
        await scheduled.runtime.runPromise(
          store.saveReconciliation(
            {
              workId: "revival",
              channelId: "800",
              streamId: "800",
              request: { kind: "message", messageId: "101" },
            },
            generation,
            { kind: "deleted", messageId: "101" },
            processingPolicy("live"),
            at
          )
        );

        const progress = await scheduled.runtime.runPromise(
          store.progress("800")
        );

        await expect(
          scheduled.runtime.runPromise(
            store.ingestPage({
              messages: [message],
              progress,
              expectedGeneration: generation,
              policyRevision: processingPolicy("live"),
              observedAt: at + 1000,
            })
          )
        ).resolves.toStrictEqual({ inserted: 0, updated: 1, unchanged: 0 });
        await expect(
          scheduled.runtime.runPromise(store.messages)
        ).resolves.toMatchObject([
          { id: "101", deletedAt: null, sourceRevision: 3 },
        ]);
        await expect(
          scheduled.runtime.runPromise(store.pending(["800"]))
        ).resolves.toMatchObject([
          { message: { id: "101", sourceRevision: 3 } },
        ]);
        await expect(
          scheduled.runtime.runPromise(store.readQuestions)
        ).resolves.toStrictEqual([]);
      }
    );
  });
});
