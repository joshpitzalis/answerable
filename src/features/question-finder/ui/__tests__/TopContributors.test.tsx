// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Contributor } from "../../domain";
import { TopContributors } from "../TopContributors";

const person = (
  name: string,
  responses: number,
  avatarUrl: string | null = null
): Contributor => ({ avatarUrl, name, responses });

describe(TopContributors, () => {
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

  it("shows each contributor's name and response count, in the order given", () => {
    render(
      <TopContributors
        contributors={[
          person("Zed Quill", 12),
          person("Amy", 7),
          person("Bo", 3),
        ]}
      />
    );

    const strip = screen.getByRole("group", { name: "Top contributors" });

    expect(
      within(strip)
        .getAllByText(/^(?:Zed Quill|Amy|Bo)$/u)
        .map((node) => node.textContent)
    ).toStrictEqual(["Zed Quill", "Amy", "Bo"]);
    expect(
      within(strip)
        .getAllByText(/^\d+$/u)
        .map((node) => node.textContent)
    ).toStrictEqual(["12", "7", "3"]);
  });

  it("describes each count in words for a screen reader, as one response or several", () => {
    render(
      <TopContributors contributors={[person("Amy", 12), person("Bo", 1)]} />
    );

    const strip = screen.getByRole("group", { name: "Top contributors" });

    expect(
      [...strip.querySelectorAll("[aria-description]")].map((node) =>
        node.getAttribute("aria-description")
      )
    ).toStrictEqual(["12 responses", "1 response"]);
  });

  it("shows nothing when there are no contributors", () => {
    render(<TopContributors contributors={[]} />);

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByText(/Top contributors/u)).toBeNull();
  });

  it("shows the avatar image beside a contributor who has one, as decoration next to the name", () => {
    render(
      <TopContributors
        contributors={[person("Amy", 2, "https://cdn.test/amy.png")]}
      />
    );

    const strip = screen.getByRole("group", { name: "Top contributors" });
    const image = strip.querySelector("img");

    expect(image?.getAttribute("src")).toBe("https://cdn.test/amy.png");
    expect(image?.getAttribute("alt")).toBe("");
    // The name is read once, from the text, not again from the image.
    expect(within(strip).queryAllByRole("img")).toHaveLength(0);
    expect(within(strip).getAllByText("Amy")).toHaveLength(1);
  });

  it("falls back to initials, not a broken image, for a contributor with no avatar", () => {
    render(<TopContributors contributors={[person("Zed Quill", 2)]} />);

    const strip = screen.getByRole("group", { name: "Top contributors" });

    expect(strip.querySelector("img")).toBeNull();
    expect(within(strip).getByText("ZQ")).toBeTruthy();
  });

  it("falls back to initials when the avatar image fails to load", () => {
    render(
      <TopContributors
        contributors={[person("Zed Quill", 2, "https://cdn.test/gone.png")]}
      />
    );

    const strip = screen.getByRole("group", { name: "Top contributors" });
    const image = strip.querySelector("img");

    if (image === null) {
      throw new Error("the avatar image was not rendered");
    }

    fireEvent.error(image);

    expect(strip.querySelector("img")).toBeNull();
    expect(within(strip).getByText("ZQ")).toBeTruthy();
  });

  it("keeps a very long display name whole in the text, for the layout to cut with an ellipsis", () => {
    const long = "A".repeat(120);

    render(<TopContributors contributors={[person(long, 1)]} />);

    expect(screen.getByText(long)).toBeTruthy();
  });
});
