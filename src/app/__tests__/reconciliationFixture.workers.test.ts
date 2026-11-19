/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { reconciliationInterval } from "../../features/question-finder/domain/values/reconciliation.values";
import { EFFECT_PROJECT } from "../../features/question-finder/lib/projects.config.example";
import { Discord } from "../../features/question-finder/services/discord";
import { projectHarvestStub } from "../projectHarvest";
import { withScheduledHarvest } from "./scheduledHarvest.test-utils";

describe("fixture reconciliation", () => {
  it("retains fixture questions after the daily starter, thread metadata and recent-page checks", async () => {
    const stub = projectHarvestStub(
      env.PROJECT_HARVEST,
      EFFECT_PROJECT,
      "fixture"
    );

    const time = { now: 2_000_000_000_000 };

    await withScheduledHarvest(stub, time, Discord.stub, async (scheduled) => {
      const collect = async () => {
        for (let batch = 0; batch < 80; batch += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Each alarm resumes the committed fixture obligations.
          await scheduled.alarm(EFFECT_PROJECT);
          // oxlint-disable-next-line no-await-in-loop -- Completion is observed through the saved read seam.
          const saved = await scheduled.read(EFFECT_PROJECT);

          if (saved.harvest.status === "current") {
            return saved;
          }

          time.now += 1000;
        }

        throw new Error("Fixture reconciliation did not complete");
      };

      await scheduled.activate(EFFECT_PROJECT);
      const first = await collect();
      expect(first.questions.length).toBeGreaterThan(0);
      time.now += reconciliationInterval;
      const reconciled = await collect();
      expect({
        questions: reconciled.questions,
        counts: reconciled.contributorStats,
        failures: reconciled.failedChannels,
      }).toStrictEqual({
        questions: first.questions,
        counts: first.contributorStats,
        failures: [],
      });
    });
  });
});
