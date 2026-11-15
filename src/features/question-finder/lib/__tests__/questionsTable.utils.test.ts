import { describe, expect, it } from "vitest";

import type { QuestionsRow } from "../../domain";
import {
  isLongQuestion,
  splitPostTitle,
  toFieldDefs,
  toTableRows,
} from "../questionsTable.utils";

describe(isLongQuestion, () => {
  it("is false at 400 characters and 6 lines, true past either", () => {
    expect(isLongQuestion("x".repeat(400))).toBeFalsy();
    expect(isLongQuestion("x".repeat(401))).toBeTruthy();
    expect(isLongQuestion("a\nb\nc\nd\ne\nf")).toBeFalsy();
    expect(isLongQuestion("a\nb\nc\nd\ne\nf\ng")).toBeTruthy();
  });
});

describe(splitPostTitle, () => {
  it("takes a post's text before the first blank line as its title", () => {
    expect(
      splitPostTitle({ isPost: true, question: "Title\n\nFirst\n\nSecond" })
    ).toStrictEqual({ body: "First\n\nSecond", title: "Title" });
  });

  it("gives a text message no title", () => {
    expect(
      splitPostTitle({ isPost: false, question: "Title\n\nFirst" })
    ).toStrictEqual({ body: "Title\n\nFirst", title: undefined });
  });

  it("gives a post with no blank line no title", () => {
    expect(
      splitPostTitle({ isPost: true, question: "Only a line" })
    ).toStrictEqual({ body: "Only a line", title: undefined });
  });
});

const row = (id: string, channelName: string): QuestionsRow => ({
  id,
  project: "effect",
  channel: { id: `c-${channelName}`, name: channelName },
  name: "Ada",
  comments: 0,
  question: "How?",
  isPost: false,
  dateAsked: new Date("2026-01-01T00:00:00Z"),
  url: "https://discord.com/x",
});

describe(toTableRows, () => {
  it("flattens each Channel to its name", () => {
    const [first] = toTableRows([row("1", "effect-help")]);

    expect(first?.channel).toBe("effect-help");
    expect(first?.id).toBe("1");
  });
});

describe(toFieldDefs, () => {
  it("offers each distinct Channel name once as a filter value", () => {
    const rows = toTableRows([
      row("1", "help"),
      row("2", "guards"),
      row("3", "help"),
    ]);

    const channelDef = toFieldDefs(rows).find(
      (field) => field.key === "channel"
    );

    expect(channelDef).toMatchObject({
      enumValues: [
        { value: "help", label: "help" },
        { value: "guards", label: "guards" },
      ],
    });
  });
});
