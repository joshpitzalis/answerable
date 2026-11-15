// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { QuestionsTableRow } from "../../lib/questionsTable.utils";
import { columns } from "../TableColumn";

const row = (overrides: Partial<QuestionsTableRow>): QuestionsTableRow => ({
  channel: "help",
  comments: 0,
  dateAsked: new Date("2026-08-01T00:00:00Z"),
  id: "100",
  isPost: false,
  avatarUrl: null,
  name: "ada",
  project: "xstate",
  question: "How do actors stop?",
  url: "https://discord.com/channels/server/help/100",
  ...overrides,
});

const questionCell = (item: QuestionsTableRow): ReactNode => {
  const column = columns.find((candidate) => candidate.key === "question");

  return column?.renderCell?.(item);
};

const nameCell = (item: QuestionsTableRow): ReactNode => {
  const column = columns.find((candidate) => candidate.key === "name");

  return column?.renderCell?.(item);
};

const LONG_QUESTION = Array.from(
  { length: 12 },
  (_, index) => `Line ${index} of a long question about actors`
).join("\n\n");

describe("the table cells", () => {
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

  it("renders a code fence as code", () => {
    const { container } = render(
      questionCell(
        row({ question: "Why?\n\n```ts\nconst actor = spawn();\n```" })
      )
    );

    expect(container.querySelector("pre code")?.textContent).toBe(
      "const actor = spawn();"
    );
  });

  it("renders inline code, bold text and a link", () => {
    render(
      questionCell(
        row({
          question:
            "Does `stop()` work, **really**? See [the docs](https://example.com/docs)",
        })
      )
    );

    expect(screen.getByText("stop()").tagName).toBe("CODE");
    expect(screen.getByText("really").tagName).toBe("STRONG");
    expect(
      screen.getByRole("link", { name: "the docs" }).getAttribute("href")
    ).toBe("https://example.com/docs");
  });

  it("renders a forum post's title as a title above its text", () => {
    render(
      questionCell(
        row({
          isPost: true,
          question: "Stopping actors\n\nHow do I stop one?",
        })
      )
    );

    expect(
      screen.getByRole("heading", { name: "Stopping actors" })
    ).toBeTruthy();
    expect(screen.getByText("How do I stop one?")).toBeTruthy();
  });

  it("does not turn the first line of a text message into a title", () => {
    render(
      questionCell(row({ question: "Stopping actors\n\nHow do I stop one?" }))
    );

    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("keeps the link to the Discord thread one click away", () => {
    render(questionCell(row({})));

    const link = screen.getByRole("link", { name: "Open in Discord" });

    expect(link.getAttribute("href")).toBe(
      "https://discord.com/channels/server/help/100"
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("shows a long question cut short, and the rest after Show more", () => {
    // jsdom cannot measure height, so the cut is read off the class that applies it.
    const { container } = render(
      questionCell(row({ question: LONG_QUESTION }))
    );

    const text = container.querySelector(".astryx-markdown");
    const toggle = screen.getByRole("button", { name: "Show more" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(text?.classList.contains("max-h-40")).toBeTruthy();

    fireEvent.click(toggle);

    const expanded = screen.getByRole("button", { name: "Show less" });

    expect(expanded.getAttribute("aria-expanded")).toBe("true");
    expect(text?.classList.contains("max-h-40")).toBeFalsy();
  });

  it("offers no Show more and no cut for a short question", () => {
    const { container } = render(questionCell(row({})));

    expect(screen.queryByRole("button")).toBeNull();
    expect(
      container
        .querySelector(".astryx-markdown")
        ?.classList.contains("max-h-40")
    ).toBeFalsy();
  });

  it("shows the asker's Discord avatar image beside their name", () => {
    const { container } = render(
      nameCell(
        row({
          avatarUrl: "https://cdn.discordapp.com/avatars/u1/h1.png?size=64",
        })
      )
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.discordapp.com/avatars/u1/h1.png?size=64"
    );
  });

  it("shows no image for an asker without an avatar", () => {
    const { container } = render(nameCell(row({ avatarUrl: null })));

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText("ada").length).toBeGreaterThan(0);
  });
});
