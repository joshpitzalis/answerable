import { describe, expect, it } from "vitest";

import { advanceMessagePage } from "../domain/pagination.rules";
import type { FetchProgress } from "../domain/values/harvest.values";

const progress: FetchProgress = {
  streamId: "800",
  parentChannelId: "800",
  completedBoundary: "9",
  upperBoundary: null,
  before: null,
  seeded: true,
  lastCompletedAt: 1,
  failure: null,
  generation: 1,
};

const messages = (...ids: string[]) =>
  ids.map((id) => ({
    id,
    channelId: "800",
    parentChannelId: "800",
    threadId: null,
    authorId: "900",
    authorName: "Writer",
    authorAvatarUrl: null,
    authorIsBot: false,
    authorIsWebhook: false,
    content: "hello",
    createdAt: "2026-11-01T00:00:00Z",
    editedAt: null,
    replyCount: 0,
    isPost: false,
    url: "https://discord.com",
  }));

describe("message range progress", () => {
  it("orders unequal-length IDs and preserves a completed boundary across overlapping full pages", () => {
    const first = advanceMessagePage(progress, messages("101", "99"), 2, 2, 2);
    expect(first).toMatchObject({
      completedBoundary: "9",
      upperBoundary: "101",
      before: "99",
      generation: 1,
    });

    const second = advanceMessagePage(
      { ...progress, upperBoundary: "101", before: "99" },
      messages("99", "10"),
      3,
      2,
      2
    );

    expect(second).toMatchObject({
      completedBoundary: "9",
      upperBoundary: "101",
      before: "10",
      generation: 1,
    });
    expect(
      advanceMessagePage(
        { ...progress, upperBoundary: "101", before: "10" },
        messages("9"),
        4,
        2,
        2
      )
    ).toMatchObject({
      completedBoundary: "101",
      upperBoundary: null,
      before: null,
      generation: 2,
      lastCompletedAt: 4,
    });
  });

  it("a repeated or forward page cannot promote a boundary even when it is short", () => {
    const unfinished = { ...progress, upperBoundary: "101", before: "99" };
    expect(
      advanceMessagePage(unfinished, messages("101", "99"), 3, 2, 50)
    ).toBeNull();
    expect(
      advanceMessagePage(unfinished, messages("102", "101"), 3, 2, 2)
    ).toBeNull();
  });

  it("an empty incremental response preserves the previous boundary and completes the current generation", () => {
    expect(advanceMessagePage(progress, [], 2, 2, 50)).toMatchObject({
      completedBoundary: "9",
      before: null,
      generation: 2,
    });
  });
});
