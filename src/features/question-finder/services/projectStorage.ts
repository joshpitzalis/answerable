import { Context, Effect, Layer, Schema } from "effect";

import type { QuestionsRow } from "../domain";

export class ProjectStorageError extends Schema.TaggedError<ProjectStorageError>()(
  "ProjectStorageError",
  { operation: Schema.String, cause: Schema.Defect() }
) {}

export const projectMigrations = [
  `CREATE TABLE questions (
    id TEXT PRIMARY KEY, project TEXT NOT NULL, channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL, author_name TEXT NOT NULL, comments INTEGER NOT NULL,
    question TEXT NOT NULL, is_post INTEGER NOT NULL, avatar_url TEXT,
    date_asked TEXT NOT NULL, url TEXT NOT NULL
  );
  CREATE TABLE harvest_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_wake INTEGER);
  INSERT INTO harvest_state (id, last_wake) VALUES (1, NULL);`,
];

export const migrateProjectStorage = (
  storage: DurableObjectStorage,
  migrations: readonly string[] = projectMigrations
): void => {
  storage.transactionSync(() => {
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)"
    );
    storage.sql.exec("INSERT OR IGNORE INTO schema_version VALUES (1, 0)");

    const { version } = storage.sql
      .exec<{ version: number }>(
        "SELECT version FROM schema_version WHERE id = 1"
      )
      .one();

    if (version > migrations.length) {
      throw new Error("Unsupported future Project storage version");
    }

    for (let index = version; index < migrations.length; index += 1) {
      storage.sql.exec(migrations[index]);
      storage.sql.exec(
        "UPDATE schema_version SET version = ? WHERE id = 1",
        index + 1
      );
    }
  });
};

// oxlint-disable-next-line typescript/consistent-type-definitions -- SQLite's row constraint requires the implicit index signature of a type alias.
type StoredQuestion = {
  id: string;
  project: string;
  channel_id: string;
  channel_name: string;
  author_name: string;
  comments: number;
  question: string;
  is_post: number;
  avatar_url: string | null;
  date_asked: string;
  url: string;
};

export class ProjectStorage extends Context.Service<
  ProjectStorage,
  {
    readonly saveQuestions: (
      rows: readonly QuestionsRow[]
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly readQuestions: Effect.Effect<QuestionsRow[], ProjectStorageError>;
    readonly requestWake: (
      at: number
    ) => Effect.Effect<void, ProjectStorageError>;
    readonly recordWake: Effect.Effect<void, ProjectStorageError>;
    readonly lastWake: Effect.Effect<number | null, ProjectStorageError>;
  }
>()("app/ProjectStorage") {
  static readonly layer = (storage: DurableObjectStorage) =>
    Layer.succeed(
      ProjectStorage,
      ProjectStorage.of({
        saveQuestions: (rows) =>
          Effect.try({
            try: () =>
              storage.transactionSync(() => {
                for (const row of rows) {
                  storage.sql.exec(
                    `INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET project=excluded.project, channel_id=excluded.channel_id,
            channel_name=excluded.channel_name, author_name=excluded.author_name, comments=excluded.comments,
            question=excluded.question, is_post=excluded.is_post, avatar_url=excluded.avatar_url,
            date_asked=excluded.date_asked, url=excluded.url`,
                    row.id,
                    row.project,
                    row.channel.id,
                    row.channel.name,
                    row.name,
                    row.comments,
                    row.question,
                    Number(row.isPost),
                    row.avatarUrl,
                    row.dateAsked.toISOString(),
                    row.url
                  );
                }
              }),
            catch: (cause) =>
              new ProjectStorageError({ operation: "saveQuestions", cause }),
          }),
        readQuestions: Effect.try({
          try: () =>
            storage.sql
              .exec<StoredQuestion>("SELECT * FROM questions ORDER BY id")
              .toArray()
              .map((row) => ({
                id: row.id,
                project: row.project,
                channel: { id: row.channel_id, name: row.channel_name },
                name: row.author_name,
                comments: row.comments,
                question: row.question,
                isPost: row.is_post === 1,
                avatarUrl: row.avatar_url,
                dateAsked: new Date(row.date_asked),
                url: row.url,
              })),
          catch: (cause) =>
            new ProjectStorageError({ operation: "readQuestions", cause }),
        }),
        requestWake: (at) =>
          Effect.tryPromise({
            try: () => storage.setAlarm(at),
            catch: (cause) =>
              new ProjectStorageError({ operation: "requestWake", cause }),
          }),
        recordWake: Effect.try({
          try: () => {
            storage.sql.exec(
              "UPDATE harvest_state SET last_wake = ? WHERE id = 1",
              Date.now()
            );
          },
          catch: (cause) =>
            new ProjectStorageError({ operation: "recordWake", cause }),
        }),
        lastWake: Effect.try({
          try: () =>
            storage.sql
              .exec<{ last_wake: number | null }>(
                "SELECT last_wake FROM harvest_state WHERE id = 1"
              )
              .one().last_wake,
          catch: (cause) =>
            new ProjectStorageError({ operation: "lastWake", cause }),
        }),
      })
    );
}
