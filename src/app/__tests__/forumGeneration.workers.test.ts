import { describe, expect, it } from "vitest";

import {
  ProjectStorage,
  ProjectStorageError,
} from "../../features/question-finder/services/projectStorage";
import { textProject } from "./harvest.test-utils";
import { at, withTrackedThread } from "./threadWriter.test-utils";

describe("forum discovery generation", () => {
  it("refuses archive work until the new generation captures its active range", async () => {
    await withTrackedThread(
      "forum-stale-active-range",
      async (scheduled, storage) => {
        const project = {
          ...textProject("forum-stale-active-range"),
          ownerName: "Changed owner",
        };

        await scheduled.read(project);
        const store = await scheduled.runtime.runPromise(ProjectStorage);
        const before = storage.sql.exec("SELECT * FROM forum_scans").toArray();

        const { generation } = storage.sql
          .exec<{ generation: number }>("SELECT generation FROM harvest_cycle")
          .one();

        await expect(
          scheduled.runtime.runPromise(
            store.saveThreadPage(
              "800",
              generation,
              { scope: "archive", threads: [], hasMore: false, isForum: true },
              at
            )
          )
        ).rejects.toBeInstanceOf(ProjectStorageError);
        expect(
          storage.sql.exec("SELECT * FROM forum_scans").toArray()
        ).toStrictEqual(before);
      }
    );
  });
});
