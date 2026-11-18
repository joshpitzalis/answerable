import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { EFFECT_PROJECT } from "../../features/question-finder/lib/projects.config.example";
import { projectHarvestStub } from "../projectHarvest";

describe("native trusted Project reads", () => {
  it("uses trusted fixture metadata and refuses a live object in fixture mode", async () => {
    const stub = projectHarvestStub(
      env.PROJECT_HARVEST,
      EFFECT_PROJECT,
      "fixture"
    );

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

    await stub.saveQuestions([question]);

    const saved = await stub.read({
      ...EFFECT_PROJECT,
      serverId: "untrusted",
      slug: "untrusted",
      channels: [],
    });

    expect(saved.questions).toStrictEqual([question]);
    await runInDurableObject(
      projectHarvestStub(env.PROJECT_HARVEST, EFFECT_PROJECT, "live"),
      async (instance) => {
        await expect(instance.read(EFFECT_PROJECT)).rejects.toThrow(
          "Unknown Project storage identity"
        );
      }
    );
  });
});
