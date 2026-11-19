import { describe, expect, it } from "vitest";

import type { Contributor, DiscordMessage, Project } from "../domain";
import { contributorStats, toRow } from "../domain";

const contributor = (
  name: string,
  responses: number,
  avatarUrl: string | null = null
): Contributor => ({ avatarUrl, name, responses });

/** Contributors named p1, p2, ... with the given counts. */
const withCounts = (counts: readonly number[]): Contributor[] =>
  counts.map((responses, index) => contributor(`p${index + 1}`, responses));

describe(contributorStats, () => {
  it("has no statistic when nobody has contributed", () => {
    expect(contributorStats([])).toBeNull();
  });

  it("gives the middle count as the median for an odd number of contributors", () => {
    // Mean 2, population SD sqrt(2) = 1.414, so mean + SD = 3.41 and 4 is the first whole count at or above it.
    expect(contributorStats(withCounts([1, 1, 4]))).toMatchObject({
      medianResponses: 1,
      plusOneSd: 4,
    });
  });

  it("gives the average of the two middle counts as the median for an even number of contributors", () => {
    // Sorted 1, 2, 3, 10: median (2 + 3) / 2. Mean 4, population SD sqrt(12.5) = 3.54, so 7.54 and 8.
    expect(contributorStats(withCounts([10, 3, 1, 2]))).toMatchObject({
      medianResponses: 2.5,
      plusOneSd: 8,
    });
  });

  it("keeps the median at the typical count when one account writes far more", () => {
    // Median 1. Mean 12.2, SD sqrt(458.56) = 21.41, mean + SD = 33.61, so 34.
    expect(contributorStats(withCounts([1, 1, 1, 3, 55]))).toMatchObject({
      medianResponses: 1,
      plusOneSd: 34,
    });
  });

  it("uses the population standard deviation, not the sample one", () => {
    // Median (4 + 5) / 2. Mean 5, population SD exactly 2, so 7. The sample SD (2.14) would give 8.
    expect(
      contributorStats(withCounts([2, 4, 4, 4, 5, 5, 7, 9]))
    ).toMatchObject({ medianResponses: 4.5, plusOneSd: 7 });
  });

  it("is the count itself when every contributor wrote the same number", () => {
    expect(contributorStats(withCounts([3, 3, 3]))).toMatchObject({
      medianResponses: 3,
      plusOneSd: 3,
    });
  });

  it("is that contributor's count when there is only one", () => {
    expect(contributorStats(withCounts([5]))).toMatchObject({
      medianResponses: 5,
      plusOneSd: 5,
    });
  });

  describe("the top contributors", () => {
    it("are the five with the most responses, most first, with the name, the count and the avatar", () => {
      const stats = contributorStats([
        contributor("Cal", 3),
        contributor("Eli", 2),
        contributor("Zed", 5, "https://cdn.test/zed.png"),
        contributor("Fay", 1),
        contributor("Amy", 4),
        contributor("Dov", 2),
        contributor("Bea", 6),
      ]);

      expect(stats?.topContributors).toStrictEqual([
        contributor("Bea", 6),
        contributor("Zed", 5, "https://cdn.test/zed.png"),
        contributor("Amy", 4),
        contributor("Cal", 3),
        contributor("Dov", 2),
      ]);
    });

    it("break a tie by name A to Z, also where the cap of five falls", () => {
      const stats = contributorStats([
        contributor("Zed", 5),
        contributor("Cal", 3),
        contributor("Amy", 3),
        contributor("Eli", 2),
        contributor("Bea", 3),
        contributor("Dov", 2),
        contributor("Fay", 1),
      ]);

      // Dov and Eli tie for fifth place; Dov comes first by name.
      expect(stats?.topContributors.map(({ name }) => name)).toStrictEqual([
        "Zed",
        "Amy",
        "Bea",
        "Cal",
        "Dov",
      ]);
    });

    it("are fewer than five when there are fewer contributors", () => {
      const stats = contributorStats([
        contributor("Bo", 1),
        contributor("Ana", 2),
      ]);

      expect(stats?.topContributors.map(({ name }) => name)).toStrictEqual([
        "Ana",
        "Bo",
      ]);
    });
  });
});

describe(toRow, () => {
  const message: DiscordMessage = {
    authorAvatarUrl: "https://cdn.discordapp.com/avatars/u1/h1.png?size=64",
    authorIsBot: false,
    authorName: "ada",
    content: "How do actors stop?",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    id: "100",
    isPost: false,
    replyCount: 2,
    threadId: "100",
    url: "https://discord.com/channels/s1/c1/100",
  };

  const project: Project = {
    id: "xstate",
    channels: [{ id: "c1", name: "help" }],
    label: "XState",
    ownerName: "grace",
    serverId: "s1",
    slug: "xstate",
  };

  it("carries the asker's avatar onto the row", () => {
    expect(toRow(message, project, { id: "c1", name: "help" }).avatarUrl).toBe(
      "https://cdn.discordapp.com/avatars/u1/h1.png?size=64"
    );
  });

  it("leaves the row without an avatar when the asker has none", () => {
    expect(
      toRow({ ...message, authorAvatarUrl: null }, project, {
        id: "c1",
        name: "help",
      }).avatarUrl
    ).toBeNull();
  });
});
