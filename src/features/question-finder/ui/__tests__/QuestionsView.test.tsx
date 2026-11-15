// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { QuestionsReply } from "../../domain";
import { createQuestionsMachine } from "../questionsMachine";
import { QuestionsView } from "../QuestionsView";

const reply = (overrides: Partial<QuestionsReply>): QuestionsReply => ({
  contributorStats: null,
  failedChannels: [],
  questions: [],
  ...overrides,
});

const viewOf = (loaded: QuestionsReply) => (
  <QuestionsView
    machine={createQuestionsMachine(() => Promise.resolve(loaded))}
    title="XState Questions"
  />
);

describe("the questions headline", () => {
  // jsdom has no matchMedia, which Astryx's theme hook reads.
  beforeAll(() => {
    window.matchMedia = (query: string) =>
      Object.assign(new EventTarget(), {
        addListener: () => {},
        matches: false,
        media: query,
        onchange: null,
        removeListener: () => {},
      });
  });

  afterEach(cleanup);

  it("shows the median statistic beside the table heading", async () => {
    render(
      viewOf(
        reply({
          contributorStats: {
            medianResponses: 1,
            plusOneSd: 12,
            topContributors: [],
          },
        })
      )
    );

    await expect(
      screen.findByRole("heading", { name: "XState Questions" })
    ).resolves.toBeTruthy();
    expect(
      screen.getByText("median 1 response per contributor (12 = +1 SD)")
    ).toBeTruthy();
  });

  it("shows the top contributors across the top of the page", async () => {
    render(
      viewOf(
        reply({
          contributorStats: {
            medianResponses: 2.5,
            plusOneSd: 8,
            topContributors: [
              { avatarUrl: null, name: "Zed", responses: 9 },
              { avatarUrl: null, name: "Amy", responses: 4 },
            ],
          },
        })
      )
    );

    await screen.findByRole("heading", { name: "XState Questions" });

    const strip = screen.getByRole("group", { name: "Top contributors" });

    expect(
      screen.getByText("median 2.5 responses per contributor (8 = +1 SD)")
    ).toBeTruthy();
    expect(within(strip).getByText("Zed")).toBeTruthy();
    expect(within(strip).getByText("9")).toBeTruthy();
    expect(within(strip).getByText("Amy")).toBeTruthy();
    expect(within(strip).getByText("4")).toBeTruthy();
  });

  it("shows no statistic and no strip when nothing has been read", async () => {
    render(viewOf(reply({})));

    await screen.findByRole("heading", { name: "XState Questions" });

    expect(screen.queryByText(/median /u)).toBeNull();
    expect(screen.queryByText(/NaN/u)).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Top contributors" })
    ).toBeNull();
  });
});
