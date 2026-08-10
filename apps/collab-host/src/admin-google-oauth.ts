/**
 * Admin teacher Google OAuth — separate from editor Drive OAuth and admin login.
 * Requires admin session; stores encrypted refresh tokens in SQLite; pending OAuth
 * state is persisted with TTL and atomic single consume.
 *
 * Teacher credential status is resolved server-side from admin session → SQLite.
 * No browser cookie is issued for the teacher credential (PR 2.1).
 */
import {createHash, randomBytes} from "node:crypto";
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  ADMIN_GOOGLE_OAUTH_CALLBACK_PATH,
  ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH,
  ADMIN_GOOGLE_OAUTH_PICKER_TOKEN_PATH,
  ADMIN_GOOGLE_OAUTH_RETURN_FLAG,
  ADMIN_GOOGLE_OAUTH_RETURN_REASON,
  ADMIN_GOOGLE_OAUTH_SESSION_PATH,
  ADMIN_GOOGLE_OAUTH_START_PATH,
} from "@blocksync/classroom-access";
import {DRIVE_FILE_SCOPE} from "@blocksync/google-drive-sync";
import type Database from "better-sqlite3";
import {
  readAdminSession,
  requireAdminCsrf,
  type AdminAuthConfig,
  type AdminSessionStore,
} from "./admin-auth.js";
import {
  createAdminGoogleCredentialStore,
  type AdminGoogleCredentialStore,
} from "./admin-google-credential-store.js";
import {
  parseAdminGoogleCryptoKeysFromEnv,
  type AdminGoogleCryptoKeys,
} from "./admin-token-crypto.js";
import {ensureAdminAccessToken, SheetSyncError} from "./roster-sheet-sync.js";

export {ADMIN_GOOGLE_OAUTH_RETURN_FLAG, ADMIN_GOOGLE_OAUTH_RETURN_REASON};

const PENDING_TTL_MS = 10 * 60_000;
/** Reserved for PR 4 access-token refresh skew checks (see roster-sheet-sync). */
const ACCESS_SKEW_MS = 60_000;
void ACCESS_SKEW_MS;

export interface AdminGoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  cookieSecure?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
}

export function readAdminGoogleOAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AdminGoogleOAuthConfig | null {
  const clientId =
    env.GOOGLE_CLIENT_ID?.trim() || env.VITE_GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) return null;
  const redirectUri = env.SYNCRATCH_ADMIN_GOOGLE_OAUTH_REDIRECT_URI?.trim()
    || env.ADMIN_GOOGLE_OAUTH_REDIRECT_URI?.trim()
    || undefined;
  const cookieSecure =
    env.ADMIN_GOOGLE_OAUTH_COOKIE_SECURE === "1" ||
    env.ADMIN_GOOGLE_OAUTH_COOKIE_SECURE === "true" ||
    env.NODE_ENV === "production";
  return {clientId, clientSecret, redirectUri, cookieSecure};
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
  if (!raw) return "/admin";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/admin";
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
  config: AdminGoogleOAuthConfig,
  req: IncomingMessage,
): string {
  if (config.redirectUri) return config.redirectUri;
  return `${requestOrigin(req)}${ADMIN_GOOGLE_OAUTH_CALLBACK_PATH}`;
}

function nowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
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

function readAdminIdentity(
  db: Database.Database,
  adminId: string,
): {subject: string; email: string} {
  const row = db
    .prepare(`SELECT subject, email FROM admin_accounts WHERE admin_id = ?`)
    .get(adminId) as {subject?: string; email?: string} | undefined;
  if (!row?.subject || !row.email) {
    throw new Error("admin account not found");
  }
  return {subject: row.subject, email: row.email};
}

function oauthErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("missing refresh_token")) return "missing_refresh_token";
  if (message.includes("admin account not found")) return "admin_account_not_found";
  if (message.includes("drive.file")) return "scope_denied";
  if (message.includes("token exchange failed") || message.includes("invalid_grant")) {
    return "token_exchange_failed";
  }
  return "unknown";
}

function redirectOAuthResult(
  res: ServerResponse,
  req: IncomingMessage,
  returnTo: string,
  result: "ok" | "error",
  reason?: string,
): void {
  const dest = new URL(returnTo, requestOrigin(req));
  dest.searchParams.set(ADMIN_GOOGLE_OAUTH_RETURN_FLAG, result);
  if (reason) {
    dest.searchParams.set(ADMIN_GOOGLE_OAUTH_RETURN_REASON, reason);
  }
  res.writeHead(302, {
    location: dest.pathname + dest.search + dest.hash,
    "cache-control": "no-store",
  });
  res.end();
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

export function isAdminGoogleOAuthPath(urlPath: string): boolean {
  const path = pathOnly(urlPath);
  return (
    path === ADMIN_GOOGLE_OAUTH_START_PATH ||
    path === ADMIN_GOOGLE_OAUTH_CALLBACK_PATH ||
    path === ADMIN_GOOGLE_OAUTH_SESSION_PATH ||
    path === ADMIN_GOOGLE_OAUTH_PICKER_TOKEN_PATH ||
    path === ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH
  );
}

export interface CreateAdminGoogleOAuthHandlerOptions {
  enabled: boolean;
  db: Database.Database;
  adminConfig: AdminAuthConfig | null;
  adminSessions: AdminSessionStore;
  oauthConfig: AdminGoogleOAuthConfig | null;
  cryptoKeys: AdminGoogleCryptoKeys | null;
  store?: AdminGoogleCredentialStore;
}

export function createAdminGoogleOAuthHandler(
  options: CreateAdminGoogleOAuthHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const store =
    options.store ??
    (options.cryptoKeys
      ? createAdminGoogleCredentialStore(options.db, options.cryptoKeys)
      : null);
  const now = () =>
    options.oauthConfig?.now ? options.oauthConfig.now() : Date.now();
  const fetchImpl = options.oauthConfig?.fetch ?? fetch;

  return async (req, res) => {
    const urlPath = req.url ?? "/";
    if (!isAdminGoogleOAuthPath(urlPath)) return false;

    if (!options.enabled) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
      return true;
    }

    const path = pathOnly(urlPath);
    const oauthConfig = options.oauthConfig;
    const cryptoKeys = options.cryptoKeys;
    const adminConfig = options.adminConfig;

    if (!oauthConfig || !cryptoKeys || !store || !adminConfig) {
      sendJson(res, 503, {
        ok: false,
        code: "NOT_CONFIGURED",
        message:
          "Admin Google credential OAuth is not configured (client, secret, or encryption keys missing)",
      });
      return true;
    }

    const adminSession = readAdminSession(req, options.adminSessions, now());

    if (path === ADMIN_GOOGLE_OAUTH_START_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      if (!adminSession) {
        sendJson(res, 401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Admin login required before connecting Google Drive credential",
        });
        return true;
      }
      const url = new URL(urlPath, "http://local");
      const returnTo = safeReturnTo(url.searchParams.get("return"));
      const state = randomToken(24);
      const verifier = randomToken(48);
      const nowMs = now();
      store.purgeExpiredPendingOAuth(nowIso(nowMs));
      store.putPendingOAuth(
        state,
        {
          adminId: adminSession.adminId,
          codeVerifier: verifier,
          returnTo,
        },
        nowIso(nowMs + PENDING_TTL_MS),
        nowIso(nowMs),
      );
      const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorize.searchParams.set("client_id", oauthConfig.clientId);
      authorize.searchParams.set("redirect_uri", redirectUriFor(oauthConfig, req));
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", DRIVE_FILE_SCOPE);
      authorize.searchParams.set("access_type", "offline");
      authorize.searchParams.set("prompt", "consent");
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

    if (path === ADMIN_GOOGLE_OAUTH_CALLBACK_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      const url = new URL(urlPath, "http://local");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const nowMs = now();
      const pending =
        state && !error ? store.takePendingOAuth(state, nowIso(nowMs)) : null;
      const returnTo = pending?.returnTo ?? "/admin";
      if (error || !code || !state || !pending) {
        redirectOAuthResult(
          res,
          req,
          returnTo,
          "error",
          error ? "google_denied" : "pending_expired",
        );
        return true;
      }
      try {
        const token = await exchangeToken(
          fetchImpl,
          new URLSearchParams({
            code,
            client_id: oauthConfig.clientId,
            client_secret: oauthConfig.clientSecret,
            redirect_uri: redirectUriFor(oauthConfig, req),
            grant_type: "authorization_code",
            code_verifier: pending.codeVerifier,
          }),
        );
        if (!token.access_token || !token.refresh_token) {
          throw new Error("missing refresh_token from Google");
        }
        const grantedScope = token.scope ?? DRIVE_FILE_SCOPE;
        if (!grantedScope.includes("drive.file")) {
          throw new Error("Google did not grant drive.file scope");
        }
        const adminIdentity = readAdminIdentity(options.db, pending.adminId);
        const expiresInSec = Number(token.expires_in) || 3600;
        store.upsertCredential({
          adminId: pending.adminId,
          googleSubject: adminIdentity.subject,
          googleEmail: adminIdentity.email,
          scope: DRIVE_FILE_SCOPE,
          refreshToken: token.refresh_token,
          accessToken: token.access_token,
          accessExpiresAt: nowMs + expiresInSec * 1000,
          nowIso: nowIso(nowMs),
        });
        redirectOAuthResult(res, req, returnTo, "ok");
      } catch (err) {
        console.warn(
          "[collab-host] admin Google OAuth callback failed:",
          err instanceof Error ? err.message : "unknown error",
        );
        redirectOAuthResult(
          res,
          req,
          returnTo,
          "error",
          oauthErrorReason(err),
        );
      }
      return true;
    }

    if (path === ADMIN_GOOGLE_OAUTH_SESSION_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      if (!adminSession) {
        sendJson(res, 401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Admin login required",
        });
        return true;
      }
      const credential = store.getCredentialByAdminId(adminSession.adminId);
      if (!credential) {
        sendJson(res, 200, {
          ok: true,
          connected: false,
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        connected: true,
        googleEmail: credential.googleEmail,
        scope: credential.scope,
      });
      return true;
    }

    if (path === ADMIN_GOOGLE_OAUTH_PICKER_TOKEN_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      if (!adminSession) {
        sendJson(res, 401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Admin login required",
        });
        return true;
      }
      try {
        const {accessToken} = await ensureAdminAccessToken(
          {oauthConfig, credentialStore: store},
          adminSession.adminId,
        );
        sendJson(res, 200, {ok: true, accessToken});
        return true;
      } catch (error) {
        if (error instanceof SheetSyncError && error.code === "CREDENTIAL_MISSING") {
          sendJson(res, 409, {
            ok: false,
            code: "CREDENTIAL_MISSING",
            message: "Teacher Google credential is not connected",
          });
          return true;
        }
        sendJson(res, 502, {
          ok: false,
          code: "TOKEN_REFRESH_FAILED",
          message:
            error instanceof Error ? error.message : "Failed to obtain access token",
        });
        return true;
      }
    }

    if (path === ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH) {
      if (req.method !== "POST") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }
      if (!adminSession) {
        sendJson(res, 401, {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Admin login required",
        });
        return true;
      }
      if (!requireAdminCsrf(req, adminSession)) {
        sendJson(res, 403, {
          ok: false,
          code: "CSRF_FAILED",
          message: "Invalid CSRF token",
        });
        return true;
      }
      const credential = store.getCredentialByAdminId(adminSession.adminId);
      if (credential) {
        await revokeToken(fetchImpl, credential.refreshToken);
        if (credential.accessToken) {
          await revokeToken(fetchImpl, credential.accessToken);
        }
        store.deleteCredentialByAdminId(adminSession.adminId);
      }
      sendJson(res, 200, {ok: true, connected: false});
      return true;
    }

    return false;
  };
}

export {
  parseAdminGoogleCryptoKeysFromEnv,
  testAdminGoogleCryptoKeys,
} from "./admin-token-crypto.js";
