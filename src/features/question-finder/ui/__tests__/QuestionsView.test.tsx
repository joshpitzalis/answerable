// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

  it("shows the contributor statistic beside the table heading", async () => {
    render(
      viewOf(reply({ contributorStats: { meanResponses: 3.2, plusOneSd: 7 } }))
    );

    await expect(
      screen.findByRole("heading", { name: "XState Questions" })
    ).resolves.toBeTruthy();
    expect(
      screen.getByText("avg 3.2 responses per contributor (7 = +1 SD)")
    ).toBeTruthy();
  });

  it("shows no statistic when nothing has been read", async () => {
    render(viewOf(reply({})));

    await screen.findByRole("heading", { name: "XState Questions" });

    expect(screen.queryByText(/avg /u)).toBeNull();
    expect(screen.queryByText(/NaN/u)).toBeNull();
  });
});
