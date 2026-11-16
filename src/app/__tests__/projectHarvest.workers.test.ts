/// <reference types="@cloudflare/vitest-plugin/types" />
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { QuestionsRow } from "../../features/question-finder/domain";
import {
  migrateProjectStorage,
  projectMigrations,
} from "../../features/question-finder/services/projectStorage";
import { projectHarvestStub } from "../projectHarvest";

const project = { id: "invented-project", slug: "example" };

const question: QuestionsRow = {
  id: "123",
  project: "example",
  channel: { id: "456", name: "help" },
  name: "Example Writer",
  comments: 0,
  question: "How can work resume?",
  isPost: false,
  avatarUrl: null,
  dateAsked: new Date("2026-11-01T00:00:00Z"),
  url: "https://discord.com/channels/789/456/123",
};

describe("Project storage in the Workers runtime", () => {
  it("a named Project retains its question across instance eviction and alarm delivery", async () => {
    const stub = projectHarvestStub(env.PROJECT_HARVEST, project, "fixture");
    await stub.saveQuestions([question]);

    const firstInstance = await runInDurableObject(
      stub,
      (instance) => instance
    );

    await evictDurableObject(stub);
    await expect(stub.readQuestions()).resolves.toStrictEqual([question]);
    const nextInstance = await runInDurableObject(stub, (instance) => instance);
    expect(nextInstance).not.toBe(firstInstance);

    await stub.requestWake(Date.now() + 60_000);
    await expect(runDurableObjectAlarm(stub)).resolves.toBeTruthy();
    await evictDurableObject(stub);
    await expect(stub.lastWake()).resolves.toBeGreaterThan(0);
  });

  it("Project IDs and fixture/live mode isolate saved rows while slugs may change", async () => {
    const original = projectHarvestStub(
      env.PROJECT_HARVEST,
      { id: "identity" },
      "fixture"
    );

    await original.saveQuestions([question]);

    const renamed = projectHarvestStub(
      env.PROJECT_HARVEST,
      { id: "identity" },
      "fixture"
    );

    await expect(renamed.readQuestions()).resolves.toStrictEqual([question]);
    await expect(
      projectHarvestStub(
        env.PROJECT_HARVEST,
        { id: "other" },
        "fixture"
      ).readQuestions()
    ).resolves.toStrictEqual([]);
    await expect(
      projectHarvestStub(
        env.PROJECT_HARVEST,
        { id: "identity" },
        "live"
      ).readQuestions()
    ).resolves.toStrictEqual([]);
  });

  it("SQL upgrades preserve rows, failed migrations roll back, and future versions are refused", async () => {
    const stub = projectHarvestStub(
      env.PROJECT_HARVEST,
      { id: "migration" },
      "fixture"
    );

    await stub.saveQuestions([question]);
    await runInDurableObject(stub, (_instance, state) => {
      migrateProjectStorage(state.storage);

      const originalVersion = state.storage.sql
        .exec<{ version: number }>("SELECT version FROM schema_version")
        .one().version;

      expect(() =>
        migrateProjectStorage(state.storage, [
          ...projectMigrations,
          "DELETE FROM questions; CREATE TABLE migration_probe (id INTEGER); SELECT * FROM nonexistent_table;",
        ])
      ).toThrow("no such table");
      expect(
        state.storage.sql
          .exec<{ version: number }>("SELECT version FROM schema_version")
          .one().version
      ).toBe(originalVersion);
      expect(
        state.storage.sql
          .exec("SELECT name FROM sqlite_master WHERE name = 'migration_probe'")
          .toArray()
      ).toStrictEqual([]);
      migrateProjectStorage(state.storage, [
        ...projectMigrations,
        "CREATE TABLE migration_probe (id INTEGER)",
      ]);
      expect(() => migrateProjectStorage(state.storage)).toThrow(
        "Unsupported future Project storage version"
      );
      expect(
        state.storage.sql
          .exec<{ version: number }>("SELECT version FROM schema_version")
          .one().version
      ).toBe(originalVersion + 1);
    });
    await expect(stub.readQuestions()).resolves.toStrictEqual([question]);
  });
});
