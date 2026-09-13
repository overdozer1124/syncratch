/**
 * Pending OAuth state for student Google identity (grant-bound, TTL, single consume).
 */
import type Database from "better-sqlite3";

export interface StudentGooglePendingOAuth {
  grantId: string;
  codeVerifier: string;
  returnTo: string;
}

export interface StudentGoogleOAuthPendingStore {
  putPendingOAuth(
    state: string,
    pending: StudentGooglePendingOAuth,
    expiresAtIso: string,
    createdAtIso: string,
  ): void;
  takePendingOAuth(state: string, nowIso: string): StudentGooglePendingOAuth | null;
  purgeExpiredPendingOAuth(nowIso: string): number;
}

export function createStudentGoogleOAuthPendingStore(
  db: Database.Database,
): StudentGoogleOAuthPendingStore {
  const insertStmt = db.prepare(`
    INSERT INTO student_google_oauth_pending (
      state, grant_id, code_verifier, return_to, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  return {
    putPendingOAuth(state, pending, expiresAtIso, createdAtIso) {
      insertStmt.run(
        state,
        pending.grantId,
        pending.codeVerifier,
        pending.returnTo,
        expiresAtIso,
        createdAtIso,
      );
    },

    takePendingOAuth(state, nowIso) {
      const row = db
        .prepare(
          `SELECT grant_id, code_verifier, return_to, expires_at
           FROM student_google_oauth_pending WHERE state = ?`,
        )
        .get(state) as
        | {
            grant_id: string;
            code_verifier: string;
            return_to: string;
            expires_at: string;
          }
        | undefined;
      if (!row || row.expires_at <= nowIso) {
        db.prepare(`DELETE FROM student_google_oauth_pending WHERE state = ?`).run(
          state,
        );
        return null;
      }
      const deleted = db
        .prepare(`DELETE FROM student_google_oauth_pending WHERE state = ?`)
        .run(state);
      if (deleted.changes === 0) return null;
      return {
        grantId: row.grant_id,
        codeVerifier: row.code_verifier,
        returnTo: row.return_to,
      };
    },

    purgeExpiredPendingOAuth(nowIso) {
      const result = db
        .prepare(`DELETE FROM student_google_oauth_pending WHERE expires_at <= ?`)
        .run(nowIso);
      return result.changes;
    },
  };
}
