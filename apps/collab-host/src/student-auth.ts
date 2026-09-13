/**
 * Student local auth — enrollment codes, passphrase hashing (scrypt), identity cookie.
 * Separate from Phase 2 student grant (`syncratch_student_grant`).
 */
import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import type {IncomingMessage, ServerResponse} from "node:http";
import type Database from "better-sqlite3";
import {createOpaqueId} from "@blocksync/classroom-access";
import {
  isStudentEmailDomainAllowed,
  normalizeGoogleEmail,
  normalizeStudentAuthMethod,
  parseAllowedEmailDomainsJson,
  studentAuthMethodIncludesGoogle,
  type StudentAuthMethod,
} from "@blocksync/classroom-access";

export const STUDENT_IDENTITY_COOKIE = "syncratch_student_identity";

/** Identity session lifetime (24h). Grant expiry still invalidates identity earlier. */
export const STUDENT_IDENTITY_TTL_MS = 24 * 60 * 60_000;

/** Enrollment code validity after admin issuance. */
export const ENROLLMENT_CODE_TTL_MS = 7 * 24 * 60 * 60_000;

export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 128;

export const GENERIC_AUTH_FAILURE_MESSAGE =
  "ログイン情報が正しくありません。";

function deriveScryptKey(
  password: string,
  salt: Buffer,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
/** Explicit maxmem for Node scrypt (Hermes requirement). */
export const SCRYPT_MAXMEM = 64 * 1024 * 1024;

const SCRYPT_OPTIONS: ScryptOptions = {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: SCRYPT_MAXMEM,
};

const ENROLLMENT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ENROLLMENT_CODE_LENGTH = 8;

export interface StudentIdentityCookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

export interface SignedIdentityPayload {
  accountId: string;
  studentId: string;
  passwordVersion: number;
  expiresAtMs: number;
  authMethod?: "local" | "google";
  googleSubject?: string;
}

export interface ResolvedGrantContext {
  grantId: string;
  linkId: string;
  policyId: string;
  rosterId: string;
  ownerAdminId: string;
  grantExpiresAt: string;
}

export interface StudentIdentitySessionView {
  authenticated: true;
  studentId: string;
  displayName: string;
  loginName: string;
}

interface AccountRow {
  account_id: string;
  student_id: string;
  status: string;
  password_hash: string | null;
  enrollment_code_hash: string | null;
  enrollment_code_expires_at: string | null;
  password_version: number;
}

interface StudentRow {
  student_id: string;
  display_name: string;
  login_name: string | null;
  student_code: string;
  google_email: string | null;
  google_subject: string | null;
  active: number;
}

export interface GrantStudentAuthPolicy {
  method: StudentAuthMethod;
  allowedEmailDomains: readonly string[];
}

class ScryptConcurrencyQueue {
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrency) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running -= 1;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

const scryptQueue = new ScryptConcurrencyQueue(3);

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function normalizeLoginName(value: string): string {
  return value.trim();
}

function normalizeEnrollmentCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function readIdentitySigningSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.SYNCRATCH_STUDENT_IDENTITY_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (env.VITEST === "true" || env.NODE_ENV === "test") {
    return "vitest-student-identity-secret";
  }
  throw new Error(
    "SYNCRATCH_STUDENT_IDENTITY_SECRET is required when student local auth is enabled",
  );
}

export function generateEnrollmentCode(): string {
  const bytes = randomBytes(ENROLLMENT_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < ENROLLMENT_CODE_LENGTH; i += 1) {
    out += ENROLLMENT_CODE_ALPHABET[bytes[i]! % ENROLLMENT_CODE_ALPHABET.length];
  }
  return out;
}

export async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptQueue.run(() =>
    deriveScryptKey(value, salt, SCRYPT_KEYLEN),
  );
  return [
    "scrypt",
    `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}`,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifySecret(
  value: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const params = parts[1] ?? "";
  if (params !== `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}`) return false;
  const salt = Buffer.from(parts[2] ?? "", "base64url");
  const expected = Buffer.from(parts[3] ?? "", "base64url");
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scryptQueue.run(() =>
    deriveScryptKey(value, salt, expected.length),
  );
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSignedIdentityToken(
  payload: SignedIdentityPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signPayload(body, secret);
  return `${body}.${sig}`;
}

export function parseSignedIdentityToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): SignedIdentityPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signPayload(body, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SignedIdentityPayload;
    if (
      !payload ||
      typeof payload.accountId !== "string" ||
      typeof payload.studentId !== "string" ||
      typeof payload.passwordVersion !== "number" ||
      typeof payload.expiresAtMs !== "number"
    ) {
      return null;
    }
    if (
      payload.authMethod !== undefined &&
      payload.authMethod !== "local" &&
      payload.authMethod !== "google"
    ) {
      return null;
    }
    if (
      payload.authMethod === "google" &&
      typeof payload.googleSubject !== "string"
    ) {
      return null;
    }
    if (payload.expiresAtMs <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readStudentIdentityToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${STUDENT_IDENTITY_COOKIE}=`)) {
      const raw = trimmed.slice(`${STUDENT_IDENTITY_COOKIE}=`.length);
      try {
        const value = decodeURIComponent(raw);
        return value.trim() || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function setStudentIdentityCookie(
  res: ServerResponse,
  token: string,
  options: StudentIdentityCookieOptions,
): void {
  const parts = [
    `${STUDENT_IDENTITY_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) parts.push("Secure");
  res.setHeader("set-cookie", parts.join("; "));
}

export function clearStudentIdentityCookie(
  res: ServerResponse,
  secure: boolean,
): void {
  const parts = [
    `${STUDENT_IDENTITY_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("set-cookie", parts.join("; "));
}

export function resolveGrantContext(
  db: Database.Database,
  grantId: string,
  now = nowIso(),
): ResolvedGrantContext | null {
  const grant = db
    .prepare(`SELECT link_id, expires_at FROM student_grants WHERE grant_id = ?`)
    .get(grantId) as {link_id: string; expires_at: string} | undefined;
  if (!grant || grant.expires_at <= now) return null;

  const row = db
    .prepare(
      `SELECT l.link_id, p.policy_id, p.roster_id, p.owner_admin_id
       FROM student_links l
       JOIN classroom_policies p ON p.policy_id = l.policy_id
       WHERE l.link_id = ?
         AND l.status = 'active'
         AND p.status = 'active'
         AND (l.expires_at IS NULL OR l.expires_at > ?)`,
    )
    .get(grant.link_id, now) as
    | {
        link_id: string;
        policy_id: string;
        roster_id: string | null;
        owner_admin_id: string;
      }
    | undefined;
  if (!row || !row.roster_id) return null;

  return {
    grantId,
    linkId: row.link_id,
    policyId: row.policy_id,
    rosterId: row.roster_id,
    ownerAdminId: row.owner_admin_id,
    grantExpiresAt: grant.expires_at,
  };
}

function getStudentInRoster(
  db: Database.Database,
  rosterId: string,
  studentId: string,
): StudentRow | null {
  const row = db
    .prepare(
      `SELECT cs.student_id, cs.display_name, cs.login_name, cs.student_code,
              cs.google_email, cs.google_subject, cs.active
       FROM classroom_students cs
       JOIN classroom_roster_memberships rm ON rm.student_id = cs.student_id
       WHERE rm.roster_id = ?
         AND rm.student_id = ?
         AND rm.active = 1`,
    )
    .get(rosterId, studentId) as StudentRow | undefined;
  if (!row || row.active !== 1) return null;
  return row;
}

export function getGrantStudentAuthPolicy(
  db: Database.Database,
  grantId: string,
  now = nowIso(),
): GrantStudentAuthPolicy | null {
  const row = db
    .prepare(
      `SELECT p.student_auth_method, p.student_auth_allowed_domains_json
       FROM student_grants g
       JOIN student_links l ON l.link_id = g.link_id
       JOIN classroom_policies p ON p.policy_id = l.policy_id
       WHERE g.grant_id = ?
         AND g.expires_at > ?
         AND l.status = 'active'
         AND p.status = 'active'`,
    )
    .get(grantId, now) as
    | {
        student_auth_method: string;
        student_auth_allowed_domains_json: string;
      }
    | undefined;
  if (!row) return null;
  return {
    method: normalizeStudentAuthMethod(row.student_auth_method),
    allowedEmailDomains: parseAllowedEmailDomainsJson(
      row.student_auth_allowed_domains_json,
    ),
  };
}

function isStudentInRoster(
  db: Database.Database,
  rosterId: string,
  studentId: string,
): boolean {
  return getStudentInRoster(db, rosterId, studentId) !== null;
}

function insertAudit(
  db: Database.Database,
  input: {
    ownerAdminId: string;
    rosterId: string | null;
    studentId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    now?: string;
  },
): void {
  db.prepare(
    `INSERT INTO classroom_audit_events (
      event_id, owner_admin_id, roster_id, student_id,
      event_type, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    createOpaqueId(),
    input.ownerAdminId,
    input.rosterId,
    input.studentId,
    input.eventType,
    JSON.stringify(input.payload),
    input.now ?? nowIso(),
  );
}

export function ensureStudentAccount(
  db: Database.Database,
  studentId: string,
  now = nowIso(),
): AccountRow {
  const existing = db
    .prepare(`SELECT * FROM student_accounts WHERE student_id = ?`)
    .get(studentId) as AccountRow | undefined;
  if (existing) return existing;

  const accountId = createOpaqueId();
  db.prepare(
    `INSERT INTO student_accounts (
      account_id, student_id, status, password_hash,
      enrollment_code_hash, enrollment_code_expires_at,
      password_version, created_at, updated_at
    ) VALUES (?, ?, 'pending_activation', NULL, NULL, NULL, 0, ?, ?)`,
  ).run(accountId, studentId, now, now);
  return db
    .prepare(`SELECT * FROM student_accounts WHERE student_id = ?`)
    .get(studentId) as AccountRow;
}

export interface IssueEnrollmentCodeResult {
  enrollmentCode: string;
  expiresAt: string;
}

export async function issueEnrollmentCode(
  db: Database.Database,
  input: {
    studentId: string;
    ownerAdminId: string;
    rosterId?: string | null;
    nowMs?: number;
  },
): Promise<IssueEnrollmentCodeResult | null> {
  const student = db
    .prepare(
      `SELECT student_id FROM classroom_students
       WHERE student_id = ? AND owner_admin_id = ? AND active = 1`,
    )
    .get(input.studentId, input.ownerAdminId) as {student_id: string} | undefined;
  if (!student) return null;

  const account = ensureStudentAccount(db, input.studentId);
  if (account.status === "disabled") return null;

  const nowMs = input.nowMs ?? Date.now();
  const ts = nowIso(nowMs);
  const expiresAt = new Date(nowMs + ENROLLMENT_CODE_TTL_MS).toISOString();
  const enrollmentCode = generateEnrollmentCode();
  const enrollmentCodeHash = await hashSecret(normalizeEnrollmentCode(enrollmentCode));

  db.prepare(
    `UPDATE student_accounts SET
      status = 'pending_activation',
      enrollment_code_hash = ?,
      enrollment_code_expires_at = ?,
      password_hash = NULL,
      updated_at = ?
     WHERE account_id = ?`,
  ).run(enrollmentCodeHash, expiresAt, ts, account.account_id);

  insertAudit(db, {
    ownerAdminId: input.ownerAdminId,
    rosterId: input.rosterId ?? null,
    studentId: input.studentId,
    eventType: "student.enrollment_code.issued",
    payload: {expiresAt},
    now: ts,
  });

  return {enrollmentCode, expiresAt};
}

export async function resetStudentPassphraseFlow(
  db: Database.Database,
  input: {
    studentId: string;
    ownerAdminId: string;
    rosterId?: string | null;
    nowMs?: number;
  },
): Promise<IssueEnrollmentCodeResult | null> {
  const issued = await issueEnrollmentCode(db, input);
  if (!issued) return null;

  const ts = nowIso(input.nowMs ?? Date.now());
  db.prepare(
    `UPDATE student_accounts SET password_version = password_version + 1, updated_at = ?
     WHERE student_id = ?`,
  ).run(ts, input.studentId);

  insertAudit(db, {
    ownerAdminId: input.ownerAdminId,
    rosterId: input.rosterId ?? null,
    studentId: input.studentId,
    eventType: "student.passphrase.reset_requested",
    payload: {expiresAt: issued.expiresAt},
    now: ts,
  });

  return issued;
}

export function revokeStudentIdentitySessions(
  db: Database.Database,
  input: {
    studentId: string;
    ownerAdminId: string;
    rosterId?: string | null;
    nowMs?: number;
  },
): boolean {
  const student = db
    .prepare(
      `SELECT student_id FROM classroom_students
       WHERE student_id = ? AND owner_admin_id = ?`,
    )
    .get(input.studentId, input.ownerAdminId) as {student_id: string} | undefined;
  if (!student) return false;

  const ts = nowIso(input.nowMs ?? Date.now());
  const result = db
    .prepare(
      `UPDATE student_accounts SET
        password_version = password_version + 1,
        updated_at = ?
       WHERE student_id = ?`,
    )
    .run(ts, input.studentId);
  if (result.changes === 0) {
    ensureStudentAccount(db, input.studentId, ts);
    db.prepare(
      `UPDATE student_accounts SET password_version = password_version + 1, updated_at = ?
       WHERE student_id = ?`,
    ).run(ts, input.studentId);
  }

  db.prepare(
    `UPDATE classroom_students SET
      google_subject = NULL,
      updated_at = ?
     WHERE student_id = ? AND owner_admin_id = ?`,
  ).run(ts, input.studentId, input.ownerAdminId);

  insertAudit(db, {
    ownerAdminId: input.ownerAdminId,
    rosterId: input.rosterId ?? null,
    studentId: input.studentId,
    eventType: "student.identity.sessions_revoked",
    payload: {},
    now: ts,
  });
  return true;
}

function validatePassphrase(passphrase: string): string | null {
  const trimmed = passphrase;
  if (trimmed.length < MIN_PASSPHRASE_LENGTH || trimmed.length > MAX_PASSPHRASE_LENGTH) {
    return "パスフレーズは8文字以上128文字以下で入力してください。";
  }
  return null;
}

async function findAccountByEnrollmentCode(
  db: Database.Database,
  rosterId: string,
  enrollmentCode: string,
  now: string,
): Promise<{account: AccountRow; student: StudentRow} | null> {
  const normalized = normalizeEnrollmentCode(enrollmentCode);
  const rows = db
    .prepare(
      `SELECT sa.*, cs.display_name, cs.login_name, cs.student_code, cs.active
       FROM student_accounts sa
       JOIN classroom_students cs ON cs.student_id = sa.student_id
       JOIN classroom_roster_memberships rm ON rm.student_id = sa.student_id
       WHERE rm.roster_id = ?
         AND rm.active = 1
         AND cs.active = 1
         AND sa.enrollment_code_hash IS NOT NULL
         AND (sa.enrollment_code_expires_at IS NULL OR sa.enrollment_code_expires_at > ?)`,
    )
    .all(rosterId, now) as Array<AccountRow & StudentRow>;

  for (const row of rows) {
    if (!row.enrollment_code_hash) continue;
    if (await verifySecret(normalized, row.enrollment_code_hash)) {
      return {
        account: row,
        student: {
          student_id: row.student_id,
          display_name: row.display_name,
          login_name: row.login_name,
          student_code: row.student_code,
          google_email: null,
          google_subject: null,
          active: row.active,
        },
      };
    }
  }
  return null;
}

export interface AuthSuccess {
  ok: true;
  accountId: string;
  studentId: string;
  passwordVersion: number;
  displayName: string;
  loginName: string;
  identityExpiresAtMs: number;
}

export type AuthFailure = {ok: false; code: string; message: string};

export async function activateStudentAccount(
  db: Database.Database,
  input: {
    grant: ResolvedGrantContext;
    enrollmentCode: string;
    passphrase: string;
    signingSecret: string;
    nowMs?: number;
  },
): Promise<AuthSuccess | AuthFailure> {
  const passphraseError = validatePassphrase(input.passphrase);
  if (passphraseError) {
    return {ok: false, code: "BAD_REQUEST", message: passphraseError};
  }

  const nowMs = input.nowMs ?? Date.now();
  const now = nowIso(nowMs);
  const match = await findAccountByEnrollmentCode(
    db,
    input.grant.rosterId,
    input.enrollmentCode,
    now,
  );
  if (!match || match.account.status === "disabled") {
    insertAudit(db, {
      ownerAdminId: input.grant.ownerAdminId,
      rosterId: input.grant.rosterId,
      studentId: null,
      eventType: "student.auth.activate_failed",
      payload: {reason: "invalid_code"},
      now,
    });
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  const passwordHash = await hashSecret(input.passphrase);
  const identityExpiresAtMs = Math.min(
    nowMs + STUDENT_IDENTITY_TTL_MS,
    Date.parse(input.grant.grantExpiresAt),
  );

  db.prepare(
    `UPDATE student_accounts SET
      status = 'active',
      password_hash = ?,
      enrollment_code_hash = NULL,
      enrollment_code_expires_at = NULL,
      password_version = password_version + 1,
      updated_at = ?
     WHERE account_id = ?`,
  ).run(passwordHash, now, match.account.account_id);

  const updated = db
    .prepare(`SELECT password_version FROM student_accounts WHERE account_id = ?`)
    .get(match.account.account_id) as {password_version: number};

  insertAudit(db, {
    ownerAdminId: input.grant.ownerAdminId,
    rosterId: input.grant.rosterId,
    studentId: match.student.student_id,
    eventType: "student.auth.activated",
    payload: {},
    now,
  });

  const loginName =
    match.student.login_name?.trim() || match.student.student_code;

  return {
    ok: true,
    accountId: match.account.account_id,
    studentId: match.student.student_id,
    passwordVersion: updated.password_version,
    displayName: match.student.display_name,
    loginName,
    identityExpiresAtMs,
  };
}

export interface GoogleAuthSuccess {
  ok: true;
  studentId: string;
  googleSubject: string;
  displayName: string;
  loginName: string;
  identityExpiresAtMs: number;
}

function findRosterStudentForGoogleLogin(
  db: Database.Database,
  grant: ResolvedGrantContext,
  googleSubject: string,
  googleEmail: string,
): StudentRow | null {
  const bySubject = db
    .prepare(
      `SELECT cs.student_id, cs.display_name, cs.login_name, cs.student_code,
              cs.google_email, cs.google_subject, cs.active
       FROM classroom_students cs
       JOIN classroom_roster_memberships rm ON rm.student_id = cs.student_id
       WHERE rm.roster_id = ?
         AND rm.active = 1
         AND cs.owner_admin_id = ?
         AND cs.active = 1
         AND cs.google_subject = ?`,
    )
    .get(grant.rosterId, grant.ownerAdminId, googleSubject) as StudentRow | undefined;
  if (bySubject) return bySubject;

  const byEmail = db
    .prepare(
      `SELECT cs.student_id, cs.display_name, cs.login_name, cs.student_code,
              cs.google_email, cs.google_subject, cs.active
       FROM classroom_students cs
       JOIN classroom_roster_memberships rm ON rm.student_id = cs.student_id
       WHERE rm.roster_id = ?
         AND rm.active = 1
         AND cs.owner_admin_id = ?
         AND cs.active = 1
         AND cs.google_email = ?`,
    )
    .get(grant.rosterId, grant.ownerAdminId, googleEmail) as StudentRow | undefined;
  return byEmail ?? null;
}

function ensureGoogleSubmissionAccount(
  db: Database.Database,
  studentId: string,
  now: string,
): AccountRow {
  const account = ensureStudentAccount(db, studentId, now);
  if (account.status === "active") return account;
  db.prepare(
    `UPDATE student_accounts SET
      status = 'active',
      updated_at = ?
     WHERE account_id = ?`,
  ).run(now, account.account_id);
  return db
    .prepare(`SELECT * FROM student_accounts WHERE account_id = ?`)
    .get(account.account_id) as AccountRow;
}

export function loginStudentViaGoogle(
  db: Database.Database,
  input: {
    grant: ResolvedGrantContext;
    googleSubject: string;
    googleEmail: string;
    emailVerified: boolean;
    authPolicy: GrantStudentAuthPolicy;
    nowMs?: number;
  },
): GoogleAuthSuccess | AuthFailure {
  if (!input.emailVerified) {
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }
  if (!studentAuthMethodIncludesGoogle(input.authPolicy.method)) {
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  const normalizedEmail = normalizeGoogleEmail(input.googleEmail);
  if (!normalizedEmail) {
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }
  if (
    !isStudentEmailDomainAllowed(normalizedEmail, input.authPolicy.allowedEmailDomains)
  ) {
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const now = nowIso(nowMs);
  const student = findRosterStudentForGoogleLogin(
    db,
    input.grant,
    input.googleSubject,
    normalizedEmail,
  );
  if (!student) {
    insertAudit(db, {
      ownerAdminId: input.grant.ownerAdminId,
      rosterId: input.grant.rosterId,
      studentId: null,
      eventType: "student.auth.google_login_failed",
      payload: {reason: "roster_mismatch"},
      now,
    });
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  if (
    student.google_subject &&
    student.google_subject !== input.googleSubject
  ) {
    insertAudit(db, {
      ownerAdminId: input.grant.ownerAdminId,
      rosterId: input.grant.rosterId,
      studentId: student.student_id,
      eventType: "student.auth.google_login_failed",
      payload: {reason: "subject_mismatch"},
      now,
    });
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  if (student.google_email && student.google_email !== normalizedEmail) {
    insertAudit(db, {
      ownerAdminId: input.grant.ownerAdminId,
      rosterId: input.grant.rosterId,
      studentId: student.student_id,
      eventType: "student.auth.google_login_failed",
      payload: {reason: "email_mismatch"},
      now,
    });
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  db.prepare(
    `UPDATE classroom_students SET
      google_email = COALESCE(google_email, ?),
      google_subject = ?,
      updated_at = ?
     WHERE student_id = ? AND owner_admin_id = ?`,
  ).run(
    normalizedEmail,
    input.googleSubject,
    now,
    student.student_id,
    input.grant.ownerAdminId,
  );

  ensureGoogleSubmissionAccount(db, student.student_id, now);

  const identityExpiresAtMs = Math.min(
    nowMs + STUDENT_IDENTITY_TTL_MS,
    Date.parse(input.grant.grantExpiresAt),
  );

  insertAudit(db, {
    ownerAdminId: input.grant.ownerAdminId,
    rosterId: input.grant.rosterId,
    studentId: student.student_id,
    eventType: "student.auth.google_login_succeeded",
    payload: {},
    now,
  });

  return {
    ok: true,
    studentId: student.student_id,
    googleSubject: input.googleSubject,
    displayName: student.display_name,
    loginName: student.login_name?.trim() || student.student_code,
    identityExpiresAtMs,
  };
}

export async function loginStudentAccount(
  db: Database.Database,
  input: {
    grant: ResolvedGrantContext;
    loginName: string;
    passphrase: string;
    nowMs?: number;
  },
): Promise<AuthSuccess | AuthFailure> {
  const loginName = normalizeLoginName(input.loginName);
  if (!loginName) {
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const now = nowIso(nowMs);
  const row = db
    .prepare(
      `SELECT sa.*, cs.display_name, cs.login_name, cs.student_code, cs.active
       FROM classroom_students cs
       JOIN classroom_roster_memberships rm ON rm.student_id = cs.student_id
       JOIN student_accounts sa ON sa.student_id = cs.student_id
       WHERE rm.roster_id = ?
         AND rm.active = 1
         AND cs.active = 1
         AND sa.status = 'active'
         AND (cs.login_name = ? OR cs.student_code = ?)`,
    )
    .get(input.grant.rosterId, loginName, loginName) as
    | (AccountRow & StudentRow)
    | undefined;

  if (!row?.password_hash) {
    insertAudit(db, {
      ownerAdminId: input.grant.ownerAdminId,
      rosterId: input.grant.rosterId,
      studentId: row?.student_id ?? null,
      eventType: "student.auth.login_failed",
      payload: {reason: "invalid_credentials"},
      now,
    });
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  const valid = await verifySecret(input.passphrase, row.password_hash);
  if (!valid) {
    insertAudit(db, {
      ownerAdminId: input.grant.ownerAdminId,
      rosterId: input.grant.rosterId,
      studentId: row.student_id,
      eventType: "student.auth.login_failed",
      payload: {reason: "invalid_credentials"},
      now,
    });
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: GENERIC_AUTH_FAILURE_MESSAGE,
    };
  }

  const identityExpiresAtMs = Math.min(
    nowMs + STUDENT_IDENTITY_TTL_MS,
    Date.parse(input.grant.grantExpiresAt),
  );

  insertAudit(db, {
    ownerAdminId: input.grant.ownerAdminId,
    rosterId: input.grant.rosterId,
    studentId: row.student_id,
    eventType: "student.auth.login_succeeded",
    payload: {},
    now,
  });

  const resolvedLoginName = row.login_name?.trim() || row.student_code;
  return {
    ok: true,
    accountId: row.account_id,
    studentId: row.student_id,
    passwordVersion: row.password_version,
    displayName: row.display_name,
    loginName: resolvedLoginName,
    identityExpiresAtMs,
  };
}

export function resolveStudentIdentitySession(
  db: Database.Database,
  input: {
    grantId: string;
    identityToken: string | null;
    signingSecret: string;
    nowMs?: number;
  },
): StudentIdentitySessionView | null {
  if (!input.identityToken) return null;
  const nowMs = input.nowMs ?? Date.now();
  const now = nowIso(nowMs);
  const grant = resolveGrantContext(db, input.grantId, now);
  if (!grant) return null;

  const payload = parseSignedIdentityToken(
    input.identityToken,
    input.signingSecret,
    nowMs,
  );
  if (!payload) return null;

  if (payload.authMethod === "google") {
    if (!payload.googleSubject || payload.googleSubject !== payload.googleSubject.trim()) {
      return null;
    }
    const student = getStudentInRoster(db, grant.rosterId, payload.studentId);
    if (!student || student.google_subject !== payload.googleSubject) {
      return null;
    }
    return {
      authenticated: true,
      studentId: student.student_id,
      displayName: student.display_name,
      loginName: student.login_name?.trim() || student.student_code,
    };
  }

  const account = db
    .prepare(`SELECT * FROM student_accounts WHERE account_id = ?`)
    .get(payload.accountId) as AccountRow | undefined;
  if (
    !account ||
    account.student_id !== payload.studentId ||
    account.status !== "active" ||
    account.password_version !== payload.passwordVersion
  ) {
    return null;
  }

  if (!isStudentInRoster(db, grant.rosterId, payload.studentId)) {
    return null;
  }

  const student = getStudentInRoster(db, grant.rosterId, payload.studentId);
  if (!student) return null;

  return {
    authenticated: true,
    studentId: student.student_id,
    displayName: student.display_name,
    loginName: student.login_name?.trim() || student.student_code,
  };
}

export function buildIdentityCookieToken(
  success: AuthSuccess,
  signingSecret: string,
): string {
  return createSignedIdentityToken(
    {
      accountId: success.accountId,
      studentId: success.studentId,
      passwordVersion: success.passwordVersion,
      expiresAtMs: success.identityExpiresAtMs,
      authMethod: "local",
    },
    signingSecret,
  );
}

export function buildGoogleIdentityCookieToken(
  success: GoogleAuthSuccess,
  signingSecret: string,
): string {
  return createSignedIdentityToken(
    {
      accountId: `google:${success.studentId}`,
      studentId: success.studentId,
      passwordVersion: 0,
      expiresAtMs: success.identityExpiresAtMs,
      authMethod: "google",
      googleSubject: success.googleSubject,
    },
    signingSecret,
  );
}
