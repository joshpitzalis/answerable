import { env } from "cloudflare:workers";
import { Effect, Logger } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { acquireStoredPage } from "../../features/question-finder/workflows/acquireStoredPage";
import { projectHarvestStub } from "../projectHarvest";
import { discordPage, sourceMessage, textProject } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("text acquisition boundaries", () => {
  it("retains saved content when a text page does not advance", async () => {
    const project = textProject("text-nonprogress");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: Date.parse("2026-11-01T00:00:00Z") };

    await withScheduledHarvest(
      stub,
      time,
      discordPage([sourceMessage("151")]),
      async (scheduled, storage) => {
        await scheduled.activate(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        await scheduled.runtime.runPromise(
          store.ingestPage({
            progress: await scheduled.runtime.runPromise(store.progress("800")),
            messages: [sourceMessage("101")],
            observedAt: time.now,
            policyRevision: "test",
          })
        );
        storage.sql.exec(
          "UPDATE fetch_progress SET seeded=1, completed_boundary='100', upper_boundary='200', before_id='151' WHERE stream_id='800'"
        );
        const before = await scheduled.runtime.runPromise(store.messages);
        const lines: string[] = [];

        await scheduled.runtime.runPromise(
          acquireStoredPage(project, "test").pipe(
            Effect.provide(
              Logger.layer([
                Logger.make(({ message }) => {
                  lines.push(String(message));
                }),
              ])
            )
          )
        );

        expect(lines).toStrictEqual([
          "harvest retry kind=acquisition attempts=1 delay_ms=1000",
          "harvest acquisition channel=1 failed=1 pending=1",
        ]);
        await expect(
          scheduled.runtime.runPromise(store.messages)
        ).resolves.toStrictEqual(before);
        await expect(
          scheduled.runtime.runPromise(store.progress("800"))
        ).resolves.toMatchObject({
          completedBoundary: "100",
          upperBoundary: "200",
          before: "151",
        });
        await expect(
          scheduled.runtime.runPromise(store.read(project))
        ).resolves.toMatchObject({
          harvest: { status: "partial" },
          failedChannels: [
            { name: "help", reason: expect.stringMatching(/\S/u) },
          ],
        });
      }
    );
  });

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
