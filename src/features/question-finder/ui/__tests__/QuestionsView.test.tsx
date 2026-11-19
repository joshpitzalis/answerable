// @vitest-environment jsdom
import {
  act,
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

  it("shows loading only until the first saved read settles", async () => {
    render(viewOf(reply({})));
    expect(screen.getByText("Loading saved questions…")).toBeTruthy();
    await screen.findByText("Up to date");
    expect(screen.queryByText("Loading saved questions…")).toBeNull();
  });

  it("offers Retry after the first read fails without inventing a saved status", async () => {
    const loaded = reply({});
    let reads = 0;
    render(
      <QuestionsView
        title="XState Questions"
        machine={createQuestionsMachine({
          load: () => {
            reads += 1;

            return reads === 1
              ? Promise.reject(new Error("Read unavailable"))
              : Promise.resolve(loaded);
          },
          activate: () => Promise.resolve(loaded),
          refresh: () => Promise.resolve(loaded),
        })}
      />
    );
    await screen.findByText("Questions could not be loaded");
    expect(screen.getByText("Read unavailable")).toBeTruthy();
    expect(screen.queryByText(/Last complete collection:/u)).toBeNull();
    expect(screen.queryByText("Up to date")).toBeNull();
    expect(screen.queryByText("Loading saved questions…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Up to date");
    expect(reads).toBe(2);
  });

  it("refreshes the visible rows and Channel filter choices", async () => {
    const loaded = reply({});
    let finishRefresh: ((value: StoredQuestionsReply) => void) | undefined;

    // oxlint-disable-next-line promise/avoid-new -- Hold the remote reply until the test releases Refresh.
    const pending = new Promise<StoredQuestionsReply>((resolve) => {
      finishRefresh = resolve;
    });

    const refreshed = reply({
      questions: [
        {
          id: "101",
          project: "example",
          channel: { id: "800", name: "Fresh channel" },
          name: "Writer",
          comments: 0,
          question: "How does the new collection appear?",
          isPost: false,
          avatarUrl: null,
          dateAsked: new Date("2026-11-01T00:00:00Z"),
          url: "https://discord.com/channels/700/800/101",
        },
      ],
    });

    render(
      <QuestionsView
        title="XState Questions"
        machine={createQuestionsMachine({
          load: () => Promise.resolve(loaded),
          activate: () => Promise.resolve(loaded),
          refresh: () => pending,
        })}
      />
    );
    await screen.findByText("Up to date");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Refreshing");
    expect(
      screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")
    ).toBeTruthy();
    await act(() => {
      finishRefresh?.(refreshed);

      return pending;
    });
    await screen.findByText("How does the new collection appear?");
    fireEvent.click(screen.getByRole("combobox", { name: "Search" }));
    fireEvent.click(await screen.findByRole("option", { name: "Channel" }));
    fireEvent.click(await screen.findByRole("combobox", { name: "Value" }));
    await expect(
      screen.findByRole("option", { name: "Fresh channel" })
    ).resolves.toBeTruthy();
  });

  it("shows time of day for distinct completion and attempt timestamps", async () => {
    render(
      viewOf(
        reply({
          harvest: {
            ...reply({}).harvest,
            lastCompleteSuccess: Date.parse("2026-11-18T09:15:00Z"),
            lastAttempt: Date.parse("2026-11-18T12:45:00Z"),
          },
        })
      )
    );
    const complete = await screen.findByText(/Last complete collection:/u);
    expect(complete.textContent).toMatch(/\d{1,2}:\d{2}/u);
    expect(screen.getByText(/Last attempt:/u).textContent).toMatch(
      /\d{1,2}:\d{2}/u
    );
  });

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
    expect(screen.getByText("Update unavailable")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Search" })).toBe(search);
    expect(screen.getByText("Connection interrupted")).toBeTruthy();
    expect(screen.getByText(/Last complete collection:/u)).toBeTruthy();
  });
});
