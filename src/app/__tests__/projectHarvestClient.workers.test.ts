import { env, withEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  EFFECT_PROJECT,
  XSTATE_PROJECT,
} from "../../features/question-finder/lib/projects.config.example";
import { projectHarvestStub } from "../projectHarvest";
import { scheduledProject } from "../projectHarvestClient";
import { activeProjects } from "../runtime";

describe("server Project storage selection", () => {
  it("uses the fixture registry when no Discord token is bound", async () => {
    await withEnv({ ...env, DISCORD_BOT_TOKEN: undefined }, () => {
      expect(activeProjects()).toStrictEqual([EFFECT_PROJECT, XSTATE_PROJECT]);
    });
  });

  it.each(["fixture", "live"] as const)(
    "routes %s calls to the stable named namespace without sharing another Project",
    async (mode) => {
      const question = {
        id: "123",
        project: EFFECT_PROJECT.slug,
        channel: EFFECT_PROJECT.channels[0],
        name: "Example writer",
        comments: 0,
        question: "Can this resume?",
        isPost: false,
        avatarUrl: null,
        dateAsked: new Date("2026-11-01T00:00:00Z"),
        url: "https://example.com/question",
      };

      await withEnv(
        {
          ...env,
          DISCORD_BOT_TOKEN: mode === "live" ? "invented-not-used" : undefined,
        },
        async () => {
          await scheduledProject(EFFECT_PROJECT).saveQuestions([question]);
          await expect(
            projectHarvestStub(
              env.PROJECT_HARVEST,
              EFFECT_PROJECT,
              mode
            ).readQuestions()
          ).resolves.toStrictEqual([question]);
          await expect(
            scheduledProject(XSTATE_PROJECT).readQuestions()
          ).resolves.toStrictEqual([]);
        }
      );
    }
  );
});
