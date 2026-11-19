import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { requireMessageAccess } from "../readAccess";

interface Overwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

const access = (
  memberRoles: string[],
  overwrites: Overwrite[] = [],
  permissions = "66560"
) => {
  const metadata = new Map([
    ["/applications/@me", { bot: { id: "600" }, flags: 262_144 }],
    [
      "/channels/800",
      {
        id: "800",
        guild_id: "700",
        type: 0,
        permission_overwrites: overwrites,
      },
    ],
    [
      "/guilds/700",
      {
        owner_id: "500",
        roles: [
          { id: "700", permissions },
          { id: "900", permissions: "65536" },
          { id: "901", permissions: "8" },
          { id: "902", permissions: "0" },
        ],
      },
    ],
    ["/guilds/700/members/600", { roles: memberRoles }],
  ]);

  const fetch: typeof globalThis.fetch = (input) =>
    Promise.resolve(
      Response.json(
        metadata.get(
          new URL(String(input)).pathname.replace(/^\/api\/v\d+/u, "")
        )
      )
    );

  return Effect.runPromise(
    requireMessageAccess("800", "700", "invented", fetch).pipe(
      Effect.catchTag("DiscordFailed", () => Effect.succeed("denied"))
    )
  );
};

describe("Discord role access", () => {
  it.each([false, true])(
    "includes extra role permissions only for assigned members: assigned=%s",
    async (assigned) => {
      await expect(access(assigned ? ["900"] : [], [], "1024")).resolves.toBe(
        assigned ? 0 : "denied"
      );
    }
  );

  it.each<{ name: string; overwrites: Overwrite[]; expected: number | string }>(
    [
      {
        name: "unassigned role cannot deny",
        overwrites: [{ id: "901", type: 0, allow: "0", deny: "65536" }],
        expected: 0,
      },
      {
        name: "another member cannot deny",
        overwrites: [{ id: "601", type: 1, allow: "0", deny: "65536" }],
        expected: 0,
      },
      {
        name: "everyone can deny",
        overwrites: [{ id: "700", type: 0, allow: "0", deny: "65536" }],
        expected: "denied",
      },
      {
        name: "assigned role can deny",
        overwrites: [{ id: "900", type: 0, allow: "0", deny: "65536" }],
        expected: "denied",
      },
      {
        name: "assigned allow follows everyone deny",
        overwrites: [
          { id: "700", type: 0, allow: "0", deny: "65536" },
          { id: "900", type: 0, allow: "65536", deny: "0" },
        ],
        expected: 0,
      },
      {
        name: "role allows combine after role denies",
        overwrites: [
          { id: "902", type: 0, allow: "65536", deny: "0" },
          { id: "900", type: 0, allow: "0", deny: "65536" },
        ],
        expected: 0,
      },
      {
        name: "member deny overrides role allow",
        overwrites: [
          { id: "900", type: 0, allow: "65536", deny: "0" },
          { id: "600", type: 1, allow: "0", deny: "65536" },
        ],
        expected: "denied",
      },
      {
        name: "member allow overrides everyone and role deny",
        overwrites: [
          { id: "700", type: 0, allow: "0", deny: "65536" },
          { id: "900", type: 0, allow: "0", deny: "65536" },
          { id: "600", type: 1, allow: "65536", deny: "0" },
        ],
        expected: 0,
      },
      {
        name: "unassigned allow cannot undo everyone deny",
        overwrites: [
          { id: "901", type: 0, allow: "65536", deny: "0" },
          { id: "700", type: 0, allow: "0", deny: "65536" },
        ],
        expected: "denied",
      },
      {
        name: "another member cannot undo own deny",
        overwrites: [
          { id: "601", type: 1, allow: "65536", deny: "0" },
          { id: "600", type: 1, allow: "0", deny: "65536" },
        ],
        expected: "denied",
      },
    ]
  )("applies overwrite precedence: $name", async ({ overwrites, expected }) => {
    await expect(access(["900", "902"], overwrites)).resolves.toBe(expected);
  });
});
