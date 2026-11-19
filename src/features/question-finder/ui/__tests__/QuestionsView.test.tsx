// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { StoredQuestionsReply } from "../../domain/values/harvest.values";
import { createQuestionsMachine } from "../questionsMachine";
import { QuestionsView } from "../QuestionsView";

const reply = (
  overrides: Partial<StoredQuestionsReply>
): StoredQuestionsReply => ({
  harvest: {
    status: "current",
    activatedAt: 1,
    lastAttempt: 1,
    lastCompleteSuccess: 1,
    initialCoverage: "latest-50",
    pendingProcessing: 0,
    nextEligibleAt: null,
  },
  contributorStats: null,
  failedChannels: [],
  questions: [],
  ...overrides,
});

const viewOf = (loaded: StoredQuestionsReply) => (
  <QuestionsView
    machine={createQuestionsMachine({
      load: () => Promise.resolve(loaded),
      activate: () => Promise.resolve(loaded),
      refresh: () => Promise.resolve(loaded),
    })}
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

  it("distinguishes initial collection from a completed empty collection", async () => {
    const initial = reply({
      harvest: {
        ...reply({}).harvest,
        status: "working",
        lastCompleteSuccess: null,
      },
    });

    const { unmount } = render(viewOf(initial));
    await screen.findByText("Collecting questions");
    expect(
      screen.getByText("First collection has not completed yet.")
    ).toBeTruthy();
    unmount();
    render(viewOf(reply({})));
    await screen.findByText("Up to date");
    expect(
      screen.queryByText("First collection has not completed yet.")
    ).toBeNull();
    expect(screen.getByText(/Last complete collection:/u)).toBeTruthy();
  });

  it("keeps the existing table mounted when Refresh fails", async () => {
    const loaded = reply({});
    render(
      <QuestionsView
        title="XState Questions"
        machine={createQuestionsMachine({
          load: () => Promise.resolve(loaded),
          activate: () => Promise.resolve(loaded),
          refresh: () => Promise.reject(new Error("Connection interrupted")),
        })}
      />
    );
    await screen.findByRole("heading", { name: "XState Questions" });
    const search = screen.getByRole("combobox", { name: "Search" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Collection status could not be updated");
    expect(screen.getByRole("combobox", { name: "Search" })).toBe(search);
    expect(screen.getByText("Connection interrupted")).toBeTruthy();
    expect(screen.getByText(/Last complete collection:/u)).toBeTruthy();
  });
});
