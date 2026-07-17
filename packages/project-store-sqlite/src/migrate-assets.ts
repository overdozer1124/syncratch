import type Database from "better-sqlite3";

export function migrateAssets(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS asset_objects (
      sha256 TEXT PRIMARY KEY
        CHECK(length(sha256) = 64
          AND sha256 = lower(sha256)
          AND sha256 NOT GLOB '*[^0-9a-f]*'),
      byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
      md5_hex TEXT NOT NULL
        CHECK(length(md5_hex) = 32
          AND md5_hex = lower(md5_hex)
          AND md5_hex NOT GLOB '*[^0-9a-f]*'),
      data_format TEXT NOT NULL
        CHECK(data_format IN ('svg','png','jpg','bmp','gif','wav','mp3')),
      gc_state TEXT NOT NULL DEFAULT 'live'
        CHECK(gc_state IN ('live','quarantining','quarantined')),
      quarantine_started_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_asset_grants (
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      sha256 TEXT NOT NULL REFERENCES asset_objects(sha256),
      granted_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, sha256)
    );

    CREATE TABLE IF NOT EXISTS asset_import_leases (
      lease_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      sha256 TEXT NOT NULL
        CHECK(length(sha256) = 64
          AND sha256 = lower(sha256)
          AND sha256 NOT GLOB '*[^0-9a-f]*'),
      import_session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS global_disk_reservations (
      reservation_id TEXT PRIMARY KEY,
      import_session_id TEXT NOT NULL UNIQUE,
      reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes >= 0),
      materialized_bytes INTEGER NOT NULL DEFAULT 0 CHECK(materialized_bytes >= 0),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK(materialized_bytes <= reserved_bytes)
    );

    CREATE TABLE IF NOT EXISTS organization_asset_quota_reservations (
      reservation_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      import_session_id TEXT NOT NULL UNIQUE,
      reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes >= 0),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_asset_quota_reservation_shas (
      reservation_id TEXT NOT NULL
        REFERENCES organization_asset_quota_reservations(reservation_id)
        ON DELETE CASCADE,
      sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
      PRIMARY KEY (reservation_id, sha256)
    );

    CREATE INDEX IF NOT EXISTS asset_import_leases_expires
      ON asset_import_leases(expires_at);
    CREATE INDEX IF NOT EXISTS asset_import_leases_session
      ON asset_import_leases(import_session_id);
    CREATE INDEX IF NOT EXISTS asset_objects_gc_state
      ON asset_objects(gc_state);
    CREATE INDEX IF NOT EXISTS quota_reservations_expires
      ON organization_asset_quota_reservations(expires_at);
    CREATE INDEX IF NOT EXISTS global_disk_reservations_expires
      ON global_disk_reservations(expires_at);

    CREATE TABLE IF NOT EXISTS asset_gc_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      owner TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  const lockColumns = db
    .prepare(`PRAGMA table_info(asset_gc_lock)`)
    .all() as Array<{ name: string }>;
  if (!lockColumns.some((column) => column.name === "generation")) {
    db.exec(`
      ALTER TABLE asset_gc_lock
      ADD COLUMN generation INTEGER NOT NULL DEFAULT 1
    `);
  }
}
