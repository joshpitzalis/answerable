import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";
import { textProject, unavailableDiscord } from "./harvest.test-utils";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("exhausted retry siblings", () => {
  it("continues ready sibling work without waiting for another Channel's exhausted retry budget", async () => {
    const project = {
      ...textProject("mixed-retry-deadlines"),
      channels: [
        { id: "800", name: "exhausted" },
        { id: "801", name: "ready" },
      ],
    };

    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const time = { now: 2_000_000_000_000 };
    await withScheduledHarvest(
      stub,
      time,
      unavailableDiscord,
      async (scheduled) => {
        await scheduled.activate(project);
        await scheduled.runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ProjectStorage;

            for (let attempt = 0; attempt < 3; attempt += 1) {
              yield* store.retry({
                kind: "acquisition",
                workId: "800",
                channelId: "800",
                reason: "Unavailable",
              });
              time.now += 1000;
            }

            expect(yield* store.finishScheduled(project, time.now)).toBe(
              time.now + 1000
            );
            expect(yield* store.claimAcquisition(project)).toMatchObject({
              channelId: "801",
            });
          })
        );
      }
    );
  });
});
