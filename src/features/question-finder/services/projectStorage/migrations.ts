export const projectMigrations = [
  `CREATE TABLE questions (
    id TEXT PRIMARY KEY, project TEXT NOT NULL, channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL, author_name TEXT NOT NULL, comments INTEGER NOT NULL,
    question TEXT NOT NULL, is_post INTEGER NOT NULL, avatar_url TEXT,
    date_asked TEXT NOT NULL, url TEXT NOT NULL
  );
  CREATE TABLE harvest_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_wake INTEGER);
  INSERT INTO harvest_state (id, last_wake) VALUES (1, NULL);`,
  `CREATE TABLE messages (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, parent_channel_id TEXT NOT NULL,
    thread_id TEXT, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
    avatar_url TEXT, is_bot INTEGER NOT NULL, is_webhook INTEGER NOT NULL,
    content TEXT NOT NULL, created_at TEXT NOT NULL, edited_at TEXT,
    reply_count INTEGER NOT NULL, is_post INTEGER NOT NULL, url TEXT NOT NULL,
    source_revision INTEGER NOT NULL, fingerprint TEXT NOT NULL,
    first_observed_at INTEGER NOT NULL, last_observed_at INTEGER NOT NULL, deleted_at INTEGER
  );
  CREATE TABLE processing (
    message_id TEXT PRIMARY KEY REFERENCES messages(id), source_revision INTEGER NOT NULL,
    policy_revision TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
    failure TEXT
  );
  CREATE TABLE fetch_progress (
    stream_id TEXT PRIMARY KEY, parent_channel_id TEXT NOT NULL,
    completed_boundary TEXT, upper_boundary TEXT, before_id TEXT,
    seeded INTEGER NOT NULL DEFAULT 0, last_completed_at INTEGER, failure TEXT
  );
  ALTER TABLE harvest_state ADD COLUMN project_id TEXT;
  ALTER TABLE harvest_state ADD COLUMN server_id TEXT;
  ALTER TABLE harvest_state ADD COLUMN activated_at INTEGER;
  ALTER TABLE harvest_state ADD COLUMN last_attempt INTEGER;
  ALTER TABLE harvest_state ADD COLUMN last_complete_success INTEGER;`,
  "ALTER TABLE processing ADD COLUMN context_revision TEXT NOT NULL DEFAULT '';",
  `ALTER TABLE fetch_progress ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE harvest_cycle (
    id INTEGER PRIMARY KEY CHECK (id=1), generation INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 0, acquire_turn INTEGER NOT NULL DEFAULT 0,
    process_turn INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO harvest_cycle (id) VALUES (1);`,
  `CREATE TABLE discord_threads (
    id TEXT PRIMARY KEY, parent_channel_id TEXT NOT NULL, title TEXT NOT NULL,
    starter_id TEXT NOT NULL UNIQUE, archived INTEGER NOT NULL, archive_timestamp TEXT NOT NULL,
    observed_at INTEGER NOT NULL, starter_pending INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX pending_forum_starters ON discord_threads (parent_channel_id,starter_pending,length(id),id);
  CREATE TABLE forum_scans (
    channel_id TEXT PRIMARY KEY, generation INTEGER NOT NULL, active_done INTEGER NOT NULL,
    archive_done INTEGER NOT NULL, before_timestamp TEXT, archive_floor TEXT NOT NULL,
    scan_upper TEXT NOT NULL
  );`,
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
