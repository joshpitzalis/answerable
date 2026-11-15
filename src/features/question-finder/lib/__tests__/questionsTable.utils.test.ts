import { describe, expect, it } from "vitest";

import type { QuestionsRow } from "../../domain";
import { toFieldDefs, toTableRows } from "../questionsTable.utils";

const row = (id: string, channelName: string): QuestionsRow => ({
  id,
  project: "effect",
  channel: { id: `c-${channelName}`, name: channelName },
  name: "Ada",
  comments: 0,
  question: "How?",
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
