/// <reference types="@cloudflare/vitest-plugin/types" />
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { activationBoundary } from "../../features/question-finder/domain/harvest.values";
import { Corpus } from "../../features/question-finder/services/corpus";
import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import {
  harvestStoredProject,
  requestStoredHarvest,
} from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import { forumThread, forumWire } from "./forum.test-utils";
import { textProject, withHarvestRuntime } from "./harvest.test-utils";

describe("stored forum Harvest", () => {
  it("seeds only the latest50 active posts, then keeps all55 new posts and deduplicates rediscovery", async () => {
    const project = textProject("forum-uncapped-incremental");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.active = Array.from({ length: 60 }, (_, index) =>
      forumThread(String(index + 1))
    );
    wire.state.active.push(...wire.state.active);
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        for (let batch = 0; batch < 2 + 50 * 2; batch += 1) {
          const before = wire.state.requests.length;
          // oxlint-disable-next-line no-await-in-loop -- Each batch resumes its predecessor's committed continuation.
          await harvestStoredProject(runtime, project, "live");
          expect(wire.state.requests.length - before).toBeLessThanOrEqual(5);
        }

        const initial = await harvestStoredProject(runtime, project, "live");
        expect({
          status: initial.harvest.status,
          ids: initial.questions
            .map((row) => Number(row.id))
            .toSorted((a, b) => a - b),
        }).toStrictEqual({
          status: "current",
          ids: Array.from({ length: 50 }, (_, index) => index + 11),
        });
        const firstNew = BigInt(activationBoundary(Date.now() + 1000));

        const added = Array.from({ length: 55 }, (_, index) =>
          forumThread(String(firstNew + BigInt(index)))
        );

        wire.state.active.push(...added, ...added);
        await runtime.runPromise(requestStoredHarvest(project));

        for (let batch = 0; batch < 2 + 55 + 105; batch += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Simulates successive bounded alarms.
          await harvestStoredProject(runtime, project, "live");
        }

        const saved = await harvestStoredProject(runtime, project, "live");
        expect({
          status: saved.harvest.status,
          count: saved.questions.length,
          contributors: saved.contributorStats?.topContributors,
        }).toMatchObject({
          status: "current",
          count: 105,
          contributors: [{ responses: 105 }],
        });

        const starters = wire.state.requests.filter((url) =>
          url.pathname.includes("/messages/")
        ).length;

        await runtime.runPromise(requestStoredHarvest(project));
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        expect(
          wire.state.requests.filter((url) =>
            url.pathname.includes("/messages/")
          )
        ).toHaveLength(starters);
      }
    );
  });

  it("retains discovered work across eviction and retries a missing starter without repeating discovery", async () => {
    const project = textProject("forum-starter-recovery");
    const time = { now: 2_000_000_000_000 };
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    let missing = true;
    const paths: string[] = [];

    const fetch: typeof globalThis.fetch = (input) => {
      const path = new URL(String(input)).pathname.replace(/^\/api\/v\d+/u, "");
      paths.push(path);

      const responses = {
        "/applications/@me": { bot: { id: "600" }, flags: 262_144 },
        "/guilds/700": { owner_id: "600", roles: [] },
        "/guilds/700/members/600": { roles: [] },
        "/channels/800": {
          id: "800",
          guild_id: "700",
          type: 15,
          permission_overwrites: [],
        },
        "/guilds/700/threads/active": {
          threads: [
            {
              id: "101",
              parent_id: "800",
              type: 11,
              name: "Layers question",
              thread_metadata: {
                archived: false,
                archive_timestamp: "2026-11-01T00:00:00.000000Z",
              },
            },
          ],
        },
        "/channels/800/threads/archived/public": {
          threads: [],
          has_more: false,
        },
        "/channels/101/messages/101": {
          id: "101",
          channel_id: "101",
          content: "A body without a question mark",
          timestamp: "2026-11-01T00:00:00Z",
          author: { id: "900", username: "Writer" },
        },
        "/channels/101/messages": [],
      };

      const response = Object.entries(responses).find(
        ([key]) => key === path
      )?.[1];

      return Promise.resolve(
        path === "/channels/101/messages/101" && missing
          ? Response.json({ code: 10_008 }, { status: 404 })
          : Response.json(response ?? {}, {
              status: response === undefined ? 404 : 200,
            })
      );
    };

    const wire = Discord.layer("invented", fetch);
    await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
        const reply = await harvestStoredProject(runtime, project, "live");
        expect(reply.harvest.status).toBe("partial");
        expect(reply.harvest.lastCompleteSuccess).toBeNull();
      },
      Corpus.stub,
      time
    );
    await evictDurableObject(stub);
    missing = false;
    time.now += 1000;
    await withHarvestRuntime(
      stub,
      wire,
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        const reply = await harvestStoredProject(runtime, project, "live");
        expect(reply.questions).toMatchObject([
          {
            id: "101",
            isPost: true,
            question: "Layers question\n\nA body without a question mark",
          },
        ]);
        expect(reply.harvest.status).toBe("current");
        expect(reply.contributorStats?.topContributors).toMatchObject([
          { name: "Writer", responses: 1 },
        ]);
      },
      Corpus.stub,
      time
    );
    expect(
      paths.filter((path) => path === "/guilds/700/threads/active")
    ).toHaveLength(1);
    expect(
      paths.filter((path) => path === "/channels/101/messages/101")
    ).toHaveLength(2);
  });
});
