// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { StoredQuestionsReply } from "../../domain/values/harvest.values";
import { EFFECT_PROJECT } from "../../lib/projects.config.example";
import { ProjectQuestions } from "../ProjectQuestions";

describe("Project questions view", () => {
  afterEach(cleanup);

  it("shows the Project label and reads its route identity", async () => {
    const slugs: string[] = [];

    const saved: StoredQuestionsReply = {
      questions: [],
      failedChannels: [],
      contributorStats: null,
      harvest: {
        status: "current",
        activatedAt: 1,
        lastAttempt: 1,
        lastCompleteSuccess: 1,
        initialCoverage: "latest-50",
        pendingProcessing: 0,
        nextEligibleAt: null,
      },
    };

    render(
      <ProjectQuestions
        project={{
          ...EFFECT_PROJECT,
          label: "Example library",
          slug: "example-library",
        }}
        load={(slug) => {
          slugs.push(slug);

          return Promise.resolve(saved);
        }}
        activate={() => Promise.resolve(saved)}
        refresh={() => Promise.resolve(saved)}
      />
    );
    await expect(
      screen.findByRole("heading", { name: "Example library Questions" })
    ).resolves.toBeTruthy();
    await screen.findByText("Up to date");
    expect(slugs).toStrictEqual(["example-library"]);
  });
});
