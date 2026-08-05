/**
 * Student Google identity OAuth — openid+email only (no drive.file).
 * Grant-bound PKCE flow; pending state in SQLite; identity via existing cookie.
 */
import {createHash, randomBytes} from "node:crypto";
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  STUDENT_AUTH_GOOGLE_CALLBACK_PATH,
  STUDENT_AUTH_GOOGLE_RETURN_FLAG,
  STUDENT_AUTH_GOOGLE_RETURN_REASON,
  STUDENT_AUTH_GOOGLE_START_PATH,
} from "@blocksync/classroom-access";
import {studentAuthMethodIncludesGoogle} from "@blocksync/classroom-access";
import {
  verifyGoogleIdToken,
  type VerifyGoogleIdTokenOptions,
  type VerifyResult,
} from "@blocksync/google-identity";

export type VerifyGoogleIdTokenFn = (
  token: string,
  options: VerifyGoogleIdTokenOptions,
) => Promise<VerifyResult>;
import type Database from "better-sqlite3";
import {readStudentGrantId} from "./student-grant.js";
import {
  buildGoogleIdentityCookieToken,
  getGrantStudentAuthPolicy,
  loginStudentViaGoogle,
  readIdentitySigningSecret,
  resolveGrantContext,
  setStudentIdentityCookie,
  STUDENT_IDENTITY_TTL_MS,
} from "./student-auth.js";
import {
  createStudentGoogleOAuthPendingStore,
  type StudentGoogleOAuthPendingStore,
} from "./student-google-oauth-pending-store.js";

export {
  STUDENT_AUTH_GOOGLE_RETURN_FLAG,
  STUDENT_AUTH_GOOGLE_RETURN_REASON,
};

const PENDING_TTL_MS = 10 * 60_000;
const GOOGLE_IDENTITY_SCOPES = "openid email";

export interface StudentGoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  cookieSecure?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
  verifyGoogleIdToken?: VerifyGoogleIdTokenFn;
}

export function readStudentGoogleOAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StudentGoogleOAuthConfig | null {
  const clientId =
    env.GOOGLE_CLIENT_ID?.trim() || env.VITE_GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    env.SYNCRATCH_STUDENT_GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    env.STUDENT_GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    undefined;
  const cookieSecure =
    env.STUDENT_GOOGLE_OAUTH_COOKIE_SECURE === "1" ||
    env.STUDENT_GOOGLE_OAUTH_COOKIE_SECURE === "true" ||
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
  config: StudentGoogleOAuthConfig,
  req: IncomingMessage,
): string {
  if (config.redirectUri) return config.redirectUri;
  return `${requestOrigin(req)}${STUDENT_AUTH_GOOGLE_CALLBACK_PATH}`;
}

function nowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
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

function oauthErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("id_token")) return "missing_id_token";
  if (message.includes("email")) return "email_not_verified";
  if (message.includes("token exchange failed") || message.includes("invalid_grant")) {
    return "token_exchange_failed";
  }
  if (message.includes("AUTH_FAILED")) return "roster_mismatch";
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
  dest.searchParams.set(STUDENT_AUTH_GOOGLE_RETURN_FLAG, result);
  if (reason) {
    dest.searchParams.set(STUDENT_AUTH_GOOGLE_RETURN_REASON, reason);
  }
  res.writeHead(302, {
    location: dest.pathname + dest.search + dest.hash,
    "cache-control": "no-store",
  });
  res.end();
}

export function isStudentGoogleOAuthPath(urlPath: string): boolean {
  const path = pathOnly(urlPath);
  return (
    path === STUDENT_AUTH_GOOGLE_START_PATH ||
    path === STUDENT_AUTH_GOOGLE_CALLBACK_PATH
  );
}

export interface CreateStudentGoogleOAuthHandlerOptions {
  enabled: boolean;
  db: Database.Database;
  oauthConfig: StudentGoogleOAuthConfig | null;
  identitySigningSecret?: string;
  cookieSecure?: boolean;
  store?: StudentGoogleOAuthPendingStore;
}

export function createStudentGoogleOAuthHandler(
  options: CreateStudentGoogleOAuthHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const store =
    options.store ?? createStudentGoogleOAuthPendingStore(options.db);
  const now = () =>
    options.oauthConfig?.now ? options.oauthConfig.now() : Date.now();
  const fetchImpl = options.oauthConfig?.fetch ?? fetch;
  const verifyIdToken =
    options.oauthConfig?.verifyGoogleIdToken ?? verifyGoogleIdToken;
  const cookieSecure =
    options.cookieSecure ??
    options.oauthConfig?.cookieSecure ??
    process.env.NODE_ENV === "production";

  return async (req, res) => {
    const urlPath = req.url ?? "/";
    if (!isStudentGoogleOAuthPath(urlPath)) return false;

    if (!options.enabled) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
      return true;
    }

    const oauthConfig = options.oauthConfig;
    if (!oauthConfig) {
      sendJson(res, 503, {
        ok: false,
        code: "NOT_CONFIGURED",
        message: "Student Google OAuth is not configured",
      });
      return true;
    }

    let signingSecret: string;
    try {
      signingSecret =
        options.identitySigningSecret ?? readIdentitySigningSecret(process.env);
    } catch {
      sendJson(res, 503, {
        ok: false,
        code: "NOT_CONFIGURED",
        message: "Student identity signing is not configured",
      });
      return true;
    }

    const path = pathOnly(urlPath);

    if (path === STUDENT_AUTH_GOOGLE_START_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "BAD_REQUEST"});
        return true;
      }

      const grantId = readStudentGrantId(req);
      if (!grantId) {
        sendJson(res, 401, {
          ok: false,
          code: "GRANT_REQUIRED",
          message: "Grant required",
        });
        return true;
      }

      const nowMs = now();
      const grant = resolveGrantContext(options.db, grantId, nowIso(nowMs));
      if (!grant) {
        sendJson(res, 401, {
          ok: false,
          code: "GRANT_REQUIRED",
          message: "Grant required",
        });
        return true;
      }

      const authPolicy = getGrantStudentAuthPolicy(
        options.db,
        grantId,
        nowIso(nowMs),
      );
      if (!authPolicy || !studentAuthMethodIncludesGoogle(authPolicy.method)) {
        sendJson(res, 403, {
          ok: false,
          code: "FORBIDDEN",
          message: "Google login is not enabled for this classroom",
        });
        return true;
      }

      const url = new URL(urlPath, "http://local");
      const returnTo = safeReturnTo(url.searchParams.get("return"));
      const state = randomToken(24);
      const verifier = randomToken(48);
      store.purgeExpiredPendingOAuth(nowIso(nowMs));
      store.putPendingOAuth(
        state,
        {
          grantId,
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
      authorize.searchParams.set("scope", GOOGLE_IDENTITY_SCOPES);
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

    if (path === STUDENT_AUTH_GOOGLE_CALLBACK_PATH) {
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
      const returnTo = pending?.returnTo ?? "/";

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
        if (!token.id_token) {
          throw new Error("missing id_token from Google");
        }

        const verified = await verifyIdToken(token.id_token, {
          audience: oauthConfig.clientId,
          requireEmailVerified: true,
          allowTestHooks: process.env.VITEST === "true",
        });
        if (!verified.ok) {
          throw new Error(verified.message || "id_token verification failed");
        }
        if (!verified.claims.email) {
          throw new Error("missing email claim");
        }

        const grant = resolveGrantContext(
          options.db,
          pending.grantId,
          nowIso(nowMs),
        );
        if (!grant) {
          redirectOAuthResult(res, req, returnTo, "error", "grant_expired");
          return true;
        }

        const authPolicy = getGrantStudentAuthPolicy(
          options.db,
          pending.grantId,
          nowIso(nowMs),
        );
        if (!authPolicy) {
          redirectOAuthResult(res, req, returnTo, "error", "grant_expired");
          return true;
        }

        const login = loginStudentViaGoogle(options.db, {
          grant,
          googleSubject: verified.claims.sub,
          googleEmail: verified.claims.email,
          emailVerified: verified.claims.email_verified === true,
          authPolicy,
          nowMs,
        });
        if (!login.ok) {
          redirectOAuthResult(res, req, returnTo, "error", "roster_mismatch");
          return true;
        }

        const identityToken = buildGoogleIdentityCookieToken(login, signingSecret);
        const maxAgeSeconds = Math.max(
          0,
          Math.floor((login.identityExpiresAtMs - nowMs) / 1000),
        );
        setStudentIdentityCookie(res, identityToken, {
          secure: cookieSecure,
          maxAgeSeconds: maxAgeSeconds || Math.floor(STUDENT_IDENTITY_TTL_MS / 1000),
        });
        redirectOAuthResult(res, req, returnTo, "ok");
      } catch (err) {
        console.warn(
          "[collab-host] student Google OAuth callback failed:",
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

    return false;
  };
}
