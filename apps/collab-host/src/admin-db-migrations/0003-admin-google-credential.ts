/**
 * Admin DB migration v3 — teacher Google OAuth credential storage.
 */
import type Database from "better-sqlite3";
import type {AdminSchemaMigration} from "./types.js";

export const ADMIN_GOOGLE_CREDENTIAL_CREATE_SQL = `
      CREATE TABLE IF NOT EXISTS admin_google_oauth_pending (
        state TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        return_to TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (admin_id) REFERENCES admin_accounts(admin_id)
      );

      CREATE TABLE IF NOT EXISTS admin_google_credentials (
        credential_id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL UNIQUE,
        google_subject TEXT NOT NULL,
        google_email TEXT NOT NULL,
        scope TEXT NOT NULL,
        key_id TEXT NOT NULL,
        refresh_token_iv TEXT NOT NULL,
        refresh_token_ciphertext TEXT NOT NULL,
        refresh_token_tag TEXT NOT NULL,
        access_token_iv TEXT,
        access_token_ciphertext TEXT,
        access_token_tag TEXT,
        access_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (admin_id) REFERENCES admin_accounts(admin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_admin_google_pending_expires
        ON admin_google_oauth_pending(expires_at);
    `;

export function applyAdminGoogleCredentialSchema(db: Database.Database): void {
  db.exec(ADMIN_GOOGLE_CREDENTIAL_CREATE_SQL);
}

export const adminGoogleCredentialChecksumSource = [
  "version=3",
  "name=admin-google-credential",
  ADMIN_GOOGLE_CREDENTIAL_CREATE_SQL,
].join("\n");

export const adminGoogleCredentialMigration: AdminSchemaMigration = {
  version: 3,
  name: "admin-google-credential",
  checksumSource: adminGoogleCredentialChecksumSource,
  checksum: "8dfc3750e6f5b10bfbebd4754a31aed53dda1370d3f9682eee0c10e9d5e96310",
  apply(db: Database.Database): void {
    applyAdminGoogleCredentialSchema(db);
  },
};
