import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { Judge } from "../../features/question-finder/services/judge";
import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import { harvestStoredProject } from "../../features/question-finder/workflows/harvestStoredProject";
import { projectHarvestStub } from "../projectHarvest";
import {
  discordPage,
  sourceMessage,
  textProject,
  withHarvestRuntime,
} from "./harvest.test-utils";

describe("page storage identity", () => {
  it.each(["channelId", "parentChannelId"])(
    "rolls back an entire page when its %s crosses streams",
    async (field) => {
      const project = textProject(`page-identity-${field}`);
      const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "live");

      const wire = discordPage([
        sourceMessage("101"),
        { ...sourceMessage("102"), [field]: "801" },
      ]);

      await withHarvestRuntime(
        stub,
        wire,
        Judge.everythingAnswerable,
        async (runtime) => {
          await expect(
            harvestStoredProject(runtime, project, "live")
          ).rejects.toBeInstanceOf(ProjectStorageError);
          await expect(
            runtime.runPromise(ProjectStorage.use((store) => store.messages))
          ).resolves.toStrictEqual([]);
          await expect(
            runtime.runPromise(
              ProjectStorage.use((store) => store.progress("800"))
            )
          ).resolves.toMatchObject({ seeded: false, completedBoundary: null });
        }
      );
    }
  );
});
