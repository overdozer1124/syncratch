import type Database from "better-sqlite3";

export function createProjectSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      head_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS project_revisions (
      project_id TEXT NOT NULL REFERENCES projects(id),
      revision INTEGER NOT NULL,
      envelope_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      client_transaction_id TEXT,
      PRIMARY KEY (project_id, revision),
      UNIQUE (project_id, client_transaction_id)
    );

    CREATE TABLE IF NOT EXISTS project_snapshots (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      based_on_revision INTEGER NOT NULL,
      reason TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);
  `);
}

export function migrate(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  createProjectSchema(db);
}
