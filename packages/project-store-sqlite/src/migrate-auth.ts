import type Database from "better-sqlite3";

export function migrateAuth(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','suspended')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_domains (
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      hosted_domain TEXT NOT NULL,
      PRIMARY KEY (organization_id, hosted_domain),
      UNIQUE (hosted_domain)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      primary_organization_id TEXT NOT NULL REFERENCES organizations(id),
      display_name TEXT,
      email TEXT,
      status TEXT NOT NULL CHECK (status IN ('active','disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_memberships (
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK (role IN ('member','admin')),
      PRIMARY KEY (organization_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS external_identities (
      provider TEXT NOT NULL CHECK (provider IN ('google')),
      subject TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, subject),
      UNIQUE (provider, subject)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      csrf_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_seen_at TEXT,
      FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_memberships(organization_id, user_id)
    );
  `);
}
