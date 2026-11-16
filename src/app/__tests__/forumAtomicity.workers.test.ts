/// <reference types="@cloudflare/vitest-plugin/types" />
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { Discord } from "../../features/question-finder/services/discord";
import { Judge } from "../../features/question-finder/services/judge";
import { ProjectStorage } from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import { forumThread, forumWire } from "./forum.test-utils";
import { textProject, withHarvestRuntime } from "./harvest.test-utils";

describe("forum starter transaction", () => {
  it("rolls back the raw starter and processing work when its obligation cannot commit", async () => {
    const project = textProject("forum-starter-atomicity");
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");
    const wire = forumWire();
    wire.state.active = [forumThread("101")];
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");
        await harvestStoredProject(runtime, project, "live");
      }
    );
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER reject_starter BEFORE UPDATE OF starter_pending ON discord_threads BEGIN SELECT RAISE(ABORT, 'injected starter commit failure'); END"
      );
    });
    await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await expect(
          harvestStoredProject(runtime, project, "live")
        ).rejects.toMatchObject({ operation: "saveForumStarter" });
        await expect(
          runtime.runPromise(ProjectStorage.use((store) => store.messages))
        ).resolves.toStrictEqual([]);
        await expect(
          runtime.runPromise(
            ProjectStorage.use((store) => store.pending(["800"]))
          )
        ).resolves.toStrictEqual([]);
      }
    );
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("DROP TRIGGER reject_starter");
    });

    const saved = await withHarvestRuntime(
      stub,
      Discord.layer("invented", wire.fetch),
      Judge.everythingAnswerable,
      async (runtime) => {
        await harvestStoredProject(runtime, project, "live");

        return harvestStoredProject(runtime, project, "live");
      }
    );

    expect(saved.questions).toMatchObject([{ id: "101" }]);
    expect(saved.harvest.status).toBe("current");
  });
});
