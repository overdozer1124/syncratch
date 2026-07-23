/**
 * Google Drive OAuth authorization-code + refresh-token endpoints.
 * Refresh tokens stay server-side; browsers only receive short-lived access
 * tokens and an opaque HttpOnly session cookie.
 */
import {createHash, randomBytes} from "node:crypto";
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  DRIVE_AUTH_SCOPES,
  DRIVE_OAUTH_CALLBACK_PATH,
  DRIVE_OAUTH_LOGOUT_PATH,
  DRIVE_OAUTH_RETURN_FLAG,
  DRIVE_OAUTH_SESSION_PATH,
  DRIVE_OAUTH_START_PATH,
  DRIVE_OAUTH_STATUS_PATH,
} from "@blocksync/google-drive-sync";

const SESSION_COOKIE = "syncratch_drive_session";
const PENDING_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const ACCESS_SKEW_MS = 60_000;

export interface DriveOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  cookieSecure?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
}

export interface DriveOAuthSessionRecord {
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: number;
  createdAt: number;
  updatedAt: number;
}

interface PendingOAuth {
  verifier: string;
  returnTo: string;
  expiresAt: number;
}

export interface DriveOAuthStore {
  putPending(state: string, pending: PendingOAuth): void;
  takePending(state: string): PendingOAuth | undefined;
  putSession(id: string, record: DriveOAuthSessionRecord): void;
  getSession(id: string): DriveOAuthSessionRecord | undefined;
  deleteSession(id: string): void;
}

export function createMemoryDriveOAuthStore(): DriveOAuthStore {
  const pending = new Map<string, PendingOAuth>();
  const sessions = new Map<string, DriveOAuthSessionRecord>();
  return {
    putPending(state, value) {
      pending.set(state, value);
    },
    takePending(state) {
      const value = pending.get(state);
      pending.delete(state);
      return value;
    },
    putSession(id, record) {
      sessions.set(id, record);
    },
    getSession(id) {
      return sessions.get(id);
    },
    deleteSession(id) {
      sessions.delete(id);
    },
  };
}

export function readDriveOAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DriveOAuthConfig | null {
  const clientId =
    env.GOOGLE_CLIENT_ID?.trim() || env.VITE_GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) return null;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || undefined;
  const cookieSecure =
    env.DRIVE_OAUTH_COOKIE_SECURE === "1" ||
    env.DRIVE_OAUTH_COOKIE_SECURE === "true" ||
    env.NODE_ENV === "production";
  return {clientId, clientSecret, redirectUri, cookieSecure};
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function pathOnly(urlPath: string): string {
  return urlPath.split("?")[0] ?? "";
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
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

function sessionCookie(
  value: string,
  options: {secure: boolean; maxAgeSec: number; clear?: boolean},
): string {
  const parts = [
    `${SESSION_COOKIE}=${options.clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.clear ? 0 : options.maxAgeSec}`,
  ];
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

function pkceChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function safeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function requestOrigin(req: IncomingMessage): string {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(protoHeader)
    ? protoHeader[0]
    : protoHeader?.split(",")[0]?.trim();
  const scheme = proto || "http";
  if (!host || Array.isArray(host)) return "http://127.0.0.1";
  return `${scheme}://${host}`;
}

function redirectUriFor(
  config: DriveOAuthConfig,
  req: IncomingMessage,
): string {
  if (config.redirectUri) return config.redirectUri;
  return `${requestOrigin(req)}${DRIVE_OAUTH_CALLBACK_PATH}`;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function exchangeToken(
  fetchImpl: typeof fetch,
  body: URLSearchParams,
): Promise<GoogleTokenResponse> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body,
  });
  const json = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    throw new Error(json.error_description || json.error || "token exchange failed");
  }
  return json;
}

async function revokeToken(
  fetchImpl: typeof fetch,
  token: string,
): Promise<void> {
  try {
    await fetchImpl("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({token}),
    });
  } catch {
    // best-effort
  }
}

export function isDriveOAuthPath(urlPath: string): boolean {
  const path = pathOnly(urlPath);
  return (
    path === DRIVE_OAUTH_STATUS_PATH ||
    path === DRIVE_OAUTH_START_PATH ||
    path === DRIVE_OAUTH_CALLBACK_PATH ||
    path === DRIVE_OAUTH_SESSION_PATH ||
    path === DRIVE_OAUTH_LOGOUT_PATH
  );
}

export function createDriveOAuthHandler(options: {
  config: DriveOAuthConfig | null;
  store?: DriveOAuthStore;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const store = options.store ?? createMemoryDriveOAuthStore();
  const now = () => (options.config?.now ? options.config.now() : Date.now());
  const fetchImpl = options.config?.fetch ?? fetch;

  return async (req, res) => {
    const urlPath = req.url ?? "/";
    if (!isDriveOAuthPath(urlPath)) return false;

    const path = pathOnly(urlPath);
    const config = options.config;

    if (path === DRIVE_OAUTH_STATUS_PATH) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      sendJson(res, 200, {ok: true, available: Boolean(config)});
      return true;
    }

    if (!config) {
      sendJson(res, 503, {
        ok: false,
        code: "NOT_CONFIGURED",
        message: "Google Drive refresh-token OAuth is not configured",
      });
      return true;
    }

    const secure = Boolean(config.cookieSecure);

    if (path === DRIVE_OAUTH_START_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      const url = new URL(urlPath, "http://local");
      const returnTo = safeReturnTo(url.searchParams.get("return"));
      const state = randomToken(24);
      const verifier = randomToken(48);
      store.putPending(state, {
        verifier,
        returnTo,
        expiresAt: now() + PENDING_TTL_MS,
      });
      const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorize.searchParams.set("client_id", config.clientId);
      authorize.searchParams.set("redirect_uri", redirectUriFor(config, req));
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", DRIVE_AUTH_SCOPES);
      authorize.searchParams.set("access_type", "offline");
      authorize.searchParams.set("prompt", "consent");
      authorize.searchParams.set("include_granted_scopes", "true");
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", pkceChallenge(verifier));
      authorize.searchParams.set("code_challenge_method", "S256");
      res.writeHead(302, {
        location: authorize.toString(),
        "cache-control": "no-store",
      });
      res.end();
      return true;
    }

    if (path === DRIVE_OAUTH_CALLBACK_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      const url = new URL(urlPath, "http://local");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const pending = state ? store.takePending(state) : undefined;
      const returnTo = pending?.returnTo ?? "/";
      if (error || !code || !state || !pending || pending.expiresAt < now()) {
        const dest = new URL(returnTo, requestOrigin(req));
        dest.searchParams.set(DRIVE_OAUTH_RETURN_FLAG, "error");
        res.writeHead(302, {location: dest.pathname + dest.search + dest.hash});
        res.end();
        return true;
      }
      try {
        const token = await exchangeToken(
          fetchImpl,
          new URLSearchParams({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: redirectUriFor(config, req),
            grant_type: "authorization_code",
            code_verifier: pending.verifier,
          }),
        );
        if (!token.access_token || !token.refresh_token) {
          throw new Error("missing refresh_token from Google");
        }
        const sessionId = randomToken(32);
        const expiresInSec = Number(token.expires_in) || 3600;
        const record: DriveOAuthSessionRecord = {
          refreshToken: token.refresh_token,
          accessToken: token.access_token,
          accessExpiresAt: now() + expiresInSec * 1000,
          createdAt: now(),
          updatedAt: now(),
        };
        store.putSession(sessionId, record);
        appendSetCookie(
          res,
          sessionCookie(sessionId, {
            secure,
            maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
          }),
        );
        const dest = new URL(returnTo, requestOrigin(req));
        dest.searchParams.set(DRIVE_OAUTH_RETURN_FLAG, "ok");
        res.writeHead(302, {
          location: dest.pathname + dest.search + dest.hash,
          "cache-control": "no-store",
        });
        res.end();
      } catch {
        const dest = new URL(returnTo, requestOrigin(req));
        dest.searchParams.set(DRIVE_OAUTH_RETURN_FLAG, "error");
        res.writeHead(302, {location: dest.pathname + dest.search + dest.hash});
        res.end();
      }
      return true;
    }

    if (path === DRIVE_OAUTH_SESSION_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE];
      if (!sessionId) {
        sendJson(res, 401, {ok: false, code: "UNAUTHORIZED"});
        return true;
      }
      const session = store.getSession(sessionId);
      if (!session) {
        appendSetCookie(res, sessionCookie("", {secure, maxAgeSec: 0, clear: true}));
        sendJson(res, 401, {ok: false, code: "UNAUTHORIZED"});
        return true;
      }
      try {
        if (
          !session.accessToken ||
          session.accessExpiresAt - ACCESS_SKEW_MS <= now()
        ) {
          const token = await exchangeToken(
            fetchImpl,
            new URLSearchParams({
              client_id: config.clientId,
              client_secret: config.clientSecret,
              refresh_token: session.refreshToken,
              grant_type: "refresh_token",
            }),
          );
          if (!token.access_token) throw new Error("refresh failed");
          const expiresInSec = Number(token.expires_in) || 3600;
          session.accessToken = token.access_token;
          session.accessExpiresAt = now() + expiresInSec * 1000;
          session.updatedAt = now();
          if (token.refresh_token) {
            session.refreshToken = token.refresh_token;
          }
          store.putSession(sessionId, session);
        }
        sendJson(res, 200, {
          ok: true,
          accessToken: session.accessToken,
          expiresAt: session.accessExpiresAt,
        });
      } catch {
        store.deleteSession(sessionId);
        appendSetCookie(res, sessionCookie("", {secure, maxAgeSec: 0, clear: true}));
        sendJson(res, 401, {ok: false, code: "UNAUTHORIZED"});
      }
      return true;
    }

    if (path === DRIVE_OAUTH_LOGOUT_PATH) {
      if (req.method !== "POST") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE];
      if (sessionId) {
        const session = store.getSession(sessionId);
        if (session) {
          await revokeToken(fetchImpl, session.refreshToken);
          if (session.accessToken) {
            await revokeToken(fetchImpl, session.accessToken);
          }
          store.deleteSession(sessionId);
        }
      }
      appendSetCookie(res, sessionCookie("", {secure, maxAgeSec: 0, clear: true}));
      sendJson(res, 200, {ok: true});
      return true;
    }

    return false;
  };
}
