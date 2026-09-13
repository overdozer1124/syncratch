import {createHash, randomBytes} from "node:crypto";
import type Database from "better-sqlite3";
import {
  decryptAdminGoogleSecret,
  encryptAdminGoogleSecret,
  type AdminGoogleCryptoKeys,
  type EncryptedSecret,
} from "./admin-token-crypto.js";

export interface AdminGooglePendingOAuth {
  adminId: string;
  codeVerifier: string;
  returnTo: string;
}

export interface AdminGoogleCredentialRecord {
  credentialId: string;
  adminId: string;
  googleSubject: string;
  googleEmail: string;
  scope: string;
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminGoogleCredentialStore {
  putPendingOAuth(
    state: string,
    pending: AdminGooglePendingOAuth,
    expiresAtIso: string,
    createdAtIso: string,
  ): void;
  takePendingOAuth(state: string, nowIso: string): AdminGooglePendingOAuth | null;
  purgeExpiredPendingOAuth(nowIso: string): number;
  upsertCredential(input: {
    adminId: string;
    googleSubject: string;
    googleEmail: string;
    scope: string;
    refreshToken: string;
    accessToken?: string | null;
    accessExpiresAt?: number | null;
    nowIso: string;
  }): AdminGoogleCredentialRecord;
  getCredentialByAdminId(adminId: string): AdminGoogleCredentialRecord | null;
  deleteCredentialByAdminId(adminId: string): boolean;
  /** Reserved for PR 4 Sheet sync / token refresh paths. */
  updateAccessToken(
    credentialId: string,
    accessToken: string | null,
    accessExpiresAt: number | null,
    nowIso: string,
  ): void;
}

interface PendingRow {
  admin_id: string;
  code_verifier: string;
  return_to: string;
}

interface CredentialRow {
  credential_id: string;
  admin_id: string;
  google_subject: string;
  google_email: string;
  scope: string;
  key_id: string;
  refresh_token_iv: string;
  refresh_token_ciphertext: string;
  refresh_token_tag: string;
  access_token_iv: string | null;
  access_token_ciphertext: string | null;
  access_token_tag: string | null;
  access_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function createOpaqueId(prefix: string): string {
  return `${prefix}_${createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 24)}`;
}

function encryptOptionalAccessToken(
  keys: AdminGoogleCryptoKeys,
  accessToken: string | null,
): {
  iv: string | null;
  ciphertext: string | null;
  tag: string | null;
} {
  if (!accessToken) {
    return {iv: null, ciphertext: null, tag: null};
  }
  const encrypted = encryptAdminGoogleSecret(keys, accessToken);
  return {
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    tag: encrypted.tag,
  };
}

function rowToCredential(
  row: CredentialRow,
  keys: AdminGoogleCryptoKeys,
): AdminGoogleCredentialRecord {
  const refreshToken = decryptAdminGoogleSecret(keys, {
    keyId: row.key_id,
    iv: row.refresh_token_iv,
    ciphertext: row.refresh_token_ciphertext,
    tag: row.refresh_token_tag,
  });
  let accessToken: string | null = null;
  if (
    row.access_token_iv &&
    row.access_token_ciphertext &&
    row.access_token_tag
  ) {
    accessToken = decryptAdminGoogleSecret(keys, {
      keyId: row.key_id,
      iv: row.access_token_iv,
      ciphertext: row.access_token_ciphertext,
      tag: row.access_token_tag,
    });
  }
  return {
    credentialId: row.credential_id,
    adminId: row.admin_id,
    googleSubject: row.google_subject,
    googleEmail: row.google_email,
    scope: row.scope,
    refreshToken,
    accessToken,
    accessExpiresAt: row.access_expires_at
      ? Date.parse(row.access_expires_at)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAdminGoogleCredentialStore(
  db: Database.Database,
  keys: AdminGoogleCryptoKeys,
): AdminGoogleCredentialStore {
  const insertPending = db.prepare(`
    INSERT INTO admin_google_oauth_pending (
      state, admin_id, code_verifier, return_to, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const takePending = db.prepare(`
    DELETE FROM admin_google_oauth_pending
    WHERE state = ? AND expires_at > ?
    RETURNING admin_id, code_verifier, return_to
  `);

  const purgeExpiredPending = db.prepare(`
    DELETE FROM admin_google_oauth_pending
    WHERE expires_at <= ?
  `);

  const selectCredentialByAdmin = db.prepare(`
    SELECT * FROM admin_google_credentials
    WHERE admin_id = ?
  `);

  const deleteCredentialByAdmin = db.prepare(`
    DELETE FROM admin_google_credentials
    WHERE admin_id = ?
  `);

  const updateAccessTokenStmt = db.prepare(`
    UPDATE admin_google_credentials SET
      access_token_iv = ?,
      access_token_ciphertext = ?,
      access_token_tag = ?,
      access_expires_at = ?,
      updated_at = ?
    WHERE credential_id = ?
  `);

  return {
    putPendingOAuth(state, pending, expiresAtIso, createdAtIso) {
      insertPending.run(
        state,
        pending.adminId,
        pending.codeVerifier,
        pending.returnTo,
        expiresAtIso,
        createdAtIso,
      );
    },

    takePendingOAuth(state, nowIso) {
      const row = takePending.get(state, nowIso) as PendingRow | undefined;
      if (!row) return null;
      return {
        adminId: row.admin_id,
        codeVerifier: row.code_verifier,
        returnTo: row.return_to,
      };
    },

    purgeExpiredPendingOAuth(nowIso) {
      return purgeExpiredPending.run(nowIso).changes;
    },

    upsertCredential(input) {
      const existing = selectCredentialByAdmin.get(input.adminId) as
        | CredentialRow
        | undefined;
      const refreshEncrypted = encryptAdminGoogleSecret(keys, input.refreshToken);
      const accessEncrypted = encryptOptionalAccessToken(
        keys,
        input.accessToken ?? null,
      );
      const accessExpiresAtIso =
        input.accessExpiresAt == null
          ? null
          : new Date(input.accessExpiresAt).toISOString();

      if (existing) {
        db.prepare(
          `UPDATE admin_google_credentials SET
            google_subject = ?,
            google_email = ?,
            scope = ?,
            key_id = ?,
            refresh_token_iv = ?,
            refresh_token_ciphertext = ?,
            refresh_token_tag = ?,
            access_token_iv = ?,
            access_token_ciphertext = ?,
            access_token_tag = ?,
            access_expires_at = ?,
            updated_at = ?
          WHERE credential_id = ?`,
        ).run(
          input.googleSubject,
          input.googleEmail,
          input.scope,
          refreshEncrypted.keyId,
          refreshEncrypted.iv,
          refreshEncrypted.ciphertext,
          refreshEncrypted.tag,
          accessEncrypted.iv,
          accessEncrypted.ciphertext,
          accessEncrypted.tag,
          accessExpiresAtIso,
          input.nowIso,
          existing.credential_id,
        );
        const updated = selectCredentialByAdmin.get(input.adminId) as CredentialRow;
        return rowToCredential(updated, keys);
      }

      const credentialId = createOpaqueId("agc");
      db.prepare(
        `INSERT INTO admin_google_credentials (
          credential_id, admin_id, google_subject, google_email, scope,
          key_id, refresh_token_iv, refresh_token_ciphertext, refresh_token_tag,
          access_token_iv, access_token_ciphertext, access_token_tag,
          access_expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        credentialId,
        input.adminId,
        input.googleSubject,
        input.googleEmail,
        input.scope,
        refreshEncrypted.keyId,
        refreshEncrypted.iv,
        refreshEncrypted.ciphertext,
        refreshEncrypted.tag,
        accessEncrypted.iv,
        accessEncrypted.ciphertext,
        accessEncrypted.tag,
        accessExpiresAtIso,
        input.nowIso,
        input.nowIso,
      );
      const inserted = selectCredentialByAdmin.get(input.adminId) as CredentialRow;
      return rowToCredential(inserted, keys);
    },

    getCredentialByAdminId(adminId) {
      const row = selectCredentialByAdmin.get(adminId) as CredentialRow | undefined;
      return row ? rowToCredential(row, keys) : null;
    },

    deleteCredentialByAdminId(adminId) {
      return deleteCredentialByAdmin.run(adminId).changes > 0;
    },

    updateAccessToken(credentialId, accessToken, accessExpiresAt, nowIso) {
      const accessEncrypted = encryptOptionalAccessToken(keys, accessToken);
      updateAccessTokenStmt.run(
        accessEncrypted.iv,
        accessEncrypted.ciphertext,
        accessEncrypted.tag,
        accessExpiresAt == null ? null : new Date(accessExpiresAt).toISOString(),
        nowIso,
        credentialId,
      );
    },
  };
}
