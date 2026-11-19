import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { acquireStoredPage } from "../../features/question-finder/workflows/acquireStoredPage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("text acquisition boundaries", () => {
  it("keeps the captured upper boundary and defers newer arrivals", async () => {
    const project = textProject("text-captured-upper");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

    await withScheduledHarvest(
      stub,
      { now: Date.parse("2026-11-01T00:00:00Z") },
      discordPage([
        sourceMessage("201"),
        sourceMessage("200"),
        sourceMessage("150"),
      ]),
      async (scheduled, storage) => {
        await scheduled.activate(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        storage.sql.exec(
          "UPDATE fetch_progress SET seeded=1, completed_boundary='100', upper_boundary='200', before_id='151' WHERE stream_id='800'"
        );

        await scheduled.runtime.runPromise(acquireStoredPage(project, "test"));

        const messages = await scheduled.runtime.runPromise(store.messages);
        expect(messages.map((message) => message.id)).toStrictEqual([
          "150",
          "200",
        ]);
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toMatchObject({
          completedBoundary: "200",
          upperBoundary: null,
          before: null,
        });
      }
    );
  });
});
