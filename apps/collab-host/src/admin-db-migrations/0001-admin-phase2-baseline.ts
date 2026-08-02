/**
 * Admin DB migration v1.
 *
 * The `checksum` constant may only be updated when registering a NEW migration
 * version. Do NOT change the SQL below after v1 has shipped in production;
 * add a new migration instead.
 */
import type Database from "better-sqlite3";
import {tableHasColumnAdmin} from "./schema-fingerprint.js";
import type {AdminSchemaMigration} from "./types.js";

export const ADMIN_PHASE2_BASELINE_CREATE_SQL = `
    CREATE TABLE IF NOT EXISTS admin_accounts (
      admin_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classroom_policies (
      policy_id TEXT PRIMARY KEY,
      owner_admin_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
      ai_enabled INTEGER NOT NULL,
      ai_level INTEGER NOT NULL,
      ai_allow_student_api_key INTEGER NOT NULL,
      editor_show_settings INTEGER NOT NULL,
      editor_allow_sb3_export INTEGER NOT NULL,
      editor_allow_sb3_import INTEGER NOT NULL,
      editor_allow_extensions INTEGER NOT NULL,
      collab_allow INTEGER NOT NULL,
      drive_allow INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_admin_id) REFERENCES admin_accounts(admin_id)
    );

    CREATE TABLE IF NOT EXISTS student_links (
      link_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      owner_admin_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      expires_at TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (policy_id) REFERENCES classroom_policies(policy_id),
      FOREIGN KEY (owner_admin_id) REFERENCES admin_accounts(admin_id)
    );

    CREATE INDEX IF NOT EXISTS idx_policies_owner
      ON classroom_policies(owner_admin_id);
    CREATE INDEX IF NOT EXISTS idx_links_owner_policy
      ON student_links(owner_admin_id, policy_id);
    CREATE INDEX IF NOT EXISTS idx_links_token
      ON student_links(token);
  `;

export const ADMIN_PHASE2_EDITOR_EXTENSIONS_ALTER_SQL = `
      ALTER TABLE classroom_policies
      ADD COLUMN editor_allow_extensions INTEGER NOT NULL DEFAULT 1
    `;

export const ADMIN_PHASE2_STUDENT_GRANTS_SQL = `
    CREATE TABLE IF NOT EXISTS student_grants (
      grant_id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (link_id) REFERENCES student_links(link_id)
    );

    CREATE INDEX IF NOT EXISTS idx_grants_link
      ON student_grants(link_id);
  `;

export function applyAdminPhase2BaselineSchema(db: Database.Database): void {
  db.exec(ADMIN_PHASE2_BASELINE_CREATE_SQL);
  if (!tableHasColumnAdmin(db, "classroom_policies", "editor_allow_extensions")) {
    db.exec(ADMIN_PHASE2_EDITOR_EXTENSIONS_ALTER_SQL);
  }
  db.exec(ADMIN_PHASE2_STUDENT_GRANTS_SQL);
}

export const adminPhase2BaselineChecksumSource = [
  "version=1",
  "name=admin-phase2-baseline",
  ADMIN_PHASE2_BASELINE_CREATE_SQL,
  ADMIN_PHASE2_EDITOR_EXTENSIONS_ALTER_SQL,
  ADMIN_PHASE2_STUDENT_GRANTS_SQL,
].join("\n");

export const adminPhase2BaselineMigration: AdminSchemaMigration = {
  version: 1,
  name: "admin-phase2-baseline",
  checksumSource: adminPhase2BaselineChecksumSource,
  checksum: "1862e9344a9912ce224bf0fa6199055cf0a0b2adcebd05436be31aa83bbcc198",
  apply(db: Database.Database): void {
    applyAdminPhase2BaselineSchema(db);
  },
};
