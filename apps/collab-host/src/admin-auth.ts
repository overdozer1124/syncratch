/**
 * Admin session auth — separate from Drive OAuth (`syncratch_drive_session`).
 * Google ID token + SYNCRATCH_ADMIN_EMAILS allowlist. No self-registration.
 */
import {randomBytes} from "node:crypto";
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_AUTH_LOGOUT_PATH,
  ADMIN_AUTH_STATUS_PATH,
  ADMIN_ME_PATH,
  isEmailAllowlisted,
  parseAdminEmailAllowlist,
} from "@blocksync/classroom-access";
import {
  verifyGoogleIdToken,
  type GoogleIdentityClaims,
  type VerifyResult,
} from "@blocksync/google-identity";
import type {AdminDb} from "./admin-db.js";

export const ADMIN_SESSION_COOKIE = "syncratch_admin_session";
export const ADMIN_CSRF_COOKIE = "syncratch_admin_csrf";

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

export interface AdminSessionRecord {
  adminId: string;
  subject: string;
  email: string;
  csrfToken: string;
  expiresAt: number;
}

export interface AdminSessionStore {
  put(id: string, record: AdminSessionRecord): void;
  get(id: string): AdminSessionRecord | undefined;
  delete(id: string): void;
}

export function createMemoryAdminSessionStore(): AdminSessionStore {
  const sessions = new Map<string, AdminSessionRecord>();
  return {
    put(id, record) {
      sessions.set(id, record);
    },
    get(id) {
      return sessions.get(id);
    },
    delete(id) {
      sessions.delete(id);
    },
  };
}

export type VerifyGoogleIdTokenFn = (
  token: string,
  options: {audience: string | string[]; requireEmailVerified?: boolean},
) => Promise<VerifyResult>;

export interface AdminAuthConfig {
  clientId: string;
  allowlist: Set<string>;
  cookieSecure: boolean;
  now?: () => number;
  verifyGoogleIdToken?: VerifyGoogleIdTokenFn;
}

export function readAdminAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AdminAuthConfig | null {
  const clientId =
    env.GOOGLE_CLIENT_ID?.trim() || env.VITE_GOOGLE_CLIENT_ID?.trim() || "";
  if (!clientId) return null;
  const allowlist = parseAdminEmailAllowlist(env.SYNCRATCH_ADMIN_EMAILS);
  const cookieSecure =
    env.ADMIN_OAUTH_COOKIE_SECURE === "1" ||
    env.ADMIN_OAUTH_COOKIE_SECURE === "true" ||
    env.NODE_ENV === "production";
  return {clientId, allowlist, cookieSecure};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function pathOnly(urlPath: string): string {
  return urlPath.split("?")[0] ?? "";
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function appendSetCookie(res: ServerResponse, value: string): void {
  const prev = res.getHeader("set-cookie");
  if (!prev) {
    res.setHeader("set-cookie", value);
    return;
  }
  if (Array.isArray(prev)) {
    res.setHeader("set-cookie", [...prev, value]);
    return;
  }
  res.setHeader("set-cookie", [String(prev), value]);
}

function cookieHeader(
  name: string,
  value: string,
  options: {secure: boolean; maxAgeSec: number; httpOnly: boolean; clear?: boolean},
): string {
  const parts = [
    `${name}=${options.clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${options.clear ? 0 : options.maxAgeSec}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomToken(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}

async function readJsonBody(
  req: IncomingMessage,
  limit = 16 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) throw new Error("body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

export interface AdminAuthContext {
  adminId: string;
  email: string;
  subject: string;
  csrfToken: string;
  sessionId: string;
}

export function readAdminSession(
  req: IncomingMessage,
  store: AdminSessionStore,
  now = Date.now(),
): AdminAuthContext | null {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[ADMIN_SESSION_COOKIE];
  if (!sessionId) return null;
  const record = store.get(sessionId);
  if (!record || record.expiresAt <= now) {
    if (sessionId) store.delete(sessionId);
    return null;
  }
  return {
    adminId: record.adminId,
    email: record.email,
    subject: record.subject,
    csrfToken: record.csrfToken,
    sessionId,
  };
}

export function requireAdminCsrf(
  req: IncomingMessage,
  session: AdminAuthContext,
): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return true;
  }
  const header = req.headers["x-csrf-token"];
  const token = Array.isArray(header) ? header[0] : header;
  return Boolean(token && token === session.csrfToken);
}

export interface CreateAdminAuthHandlerOptions {
  db: AdminDb;
  config: AdminAuthConfig | null;
  sessions?: AdminSessionStore;
}

export function createAdminAuthHandler(
  options: CreateAdminAuthHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const sessions = options.sessions ?? createMemoryAdminSessionStore();
  const verify =
    options.config?.verifyGoogleIdToken ??
    ((token, opts) =>
      verifyGoogleIdToken(token, {
        audience: opts.audience,
        requireEmailVerified: opts.requireEmailVerified ?? true,
      }));

  return async (req, res) => {
    const urlPath = pathOnly(req.url ?? "/");
    const config = options.config;

    if (urlPath === ADMIN_AUTH_STATUS_PATH && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        configured: Boolean(config && config.allowlist.size > 0),
        authenticated: Boolean(config && readAdminSession(req, sessions)),
      });
      return true;
    }

    if (!config) {
      if (
        urlPath === ADMIN_AUTH_GOOGLE_PATH ||
        urlPath === ADMIN_AUTH_LOGOUT_PATH ||
        urlPath === ADMIN_ME_PATH
      ) {
        sendJson(res, 503, {
          ok: false,
          code: "ADMIN_AUTH_NOT_CONFIGURED",
          message:
            "管理者ログインが未設定です（GOOGLE_CLIENT_ID と SYNCRATCH_ADMIN_EMAILS）。",
        });
        return true;
      }
      return false;
    }

    if (urlPath === ADMIN_AUTH_GOOGLE_PATH && req.method === "POST") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          code: "BAD_REQUEST",
          message: "JSON body required",
        });
        return true;
      }
      const idToken =
        body &&
        typeof body === "object" &&
        typeof (body as {idToken?: unknown}).idToken === "string"
          ? (body as {idToken: string}).idToken.trim()
          : "";
      if (!idToken) {
        sendJson(res, 400, {
          ok: false,
          code: "BAD_REQUEST",
          message: "idToken required",
        });
        return true;
      }

      const verified = await verify(idToken, {
        audience: config.clientId,
        requireEmailVerified: true,
      });
      if (!verified.ok) {
        sendJson(res, 401, {
          ok: false,
          code: "AUTH_FAILED",
          message: "Google ログインを確認できませんでした。",
        });
        return true;
      }

      const email = verified.claims.email;
      if (!isEmailAllowlisted(email, config.allowlist)) {
        sendJson(res, 403, {
          ok: false,
          code: "NOT_ALLOWLISTED",
          message: "このアカウントは管理者として登録されていません。",
        });
        return true;
      }

      const claimsRecord = verified.claims as GoogleIdentityClaims & {
        name?: unknown;
      };
      const admin = options.db.upsertAdminFromLogin({
        subject: verified.claims.sub,
        email: email!,
        displayName:
          typeof claimsRecord.name === "string" ? claimsRecord.name : null,
      });
      if (admin.status !== "active") {
        sendJson(res, 403, {
          ok: false,
          code: "ADMIN_DISABLED",
          message: "この管理者アカウントは無効です。",
        });
        return true;
      }

      const now = config.now?.() ?? Date.now();
      const sessionId = randomToken(32);
      const csrfToken = randomToken(24);
      sessions.put(sessionId, {
        adminId: admin.adminId,
        subject: admin.subject,
        email: admin.email,
        csrfToken,
        expiresAt: now + SESSION_TTL_MS,
      });
      const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
      appendSetCookie(
        res,
        cookieHeader(ADMIN_SESSION_COOKIE, sessionId, {
          secure: config.cookieSecure,
          maxAgeSec,
          httpOnly: true,
        }),
      );
      appendSetCookie(
        res,
        cookieHeader(ADMIN_CSRF_COOKIE, csrfToken, {
          secure: config.cookieSecure,
          maxAgeSec,
          httpOnly: false,
        }),
      );
      sendJson(res, 200, {
        ok: true,
        admin: {
          adminId: admin.adminId,
          email: admin.email,
          displayName: admin.displayName,
        },
        csrfToken,
      });
      return true;
    }

    if (urlPath === ADMIN_AUTH_LOGOUT_PATH && req.method === "POST") {
      const session = readAdminSession(req, sessions, config.now?.());
      if (session) sessions.delete(session.sessionId);
      appendSetCookie(
        res,
        cookieHeader(ADMIN_SESSION_COOKIE, "", {
          secure: config.cookieSecure,
          maxAgeSec: 0,
          httpOnly: true,
          clear: true,
        }),
      );
      appendSetCookie(
        res,
        cookieHeader(ADMIN_CSRF_COOKIE, "", {
          secure: config.cookieSecure,
          maxAgeSec: 0,
          httpOnly: false,
          clear: true,
        }),
      );
      sendJson(res, 200, {ok: true});
      return true;
    }

    if (urlPath === ADMIN_ME_PATH && req.method === "GET") {
      const session = readAdminSession(req, sessions, config.now?.());
      if (!session) {
        sendJson(res, 401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "ログインが必要です。",
        });
        return true;
      }
      const admin = options.db.getAdminById(session.adminId);
      if (!admin || admin.status !== "active") {
        sessions.delete(session.sessionId);
        sendJson(res, 401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "ログインが必要です。",
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        admin: {
          adminId: admin.adminId,
          email: admin.email,
          displayName: admin.displayName,
        },
        csrfToken: session.csrfToken,
      });
      return true;
    }

    return false;
  };
}

export function getAdminSessionsForTests(
  handlerSessions?: AdminSessionStore,
): AdminSessionStore {
  return handlerSessions ?? createMemoryAdminSessionStore();
}
