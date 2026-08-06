/**
 * Student local auth HTTP routes — gated by SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED.
 */
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  STUDENT_AUTH_ACTIVATE_PATH,
  STUDENT_AUTH_LOGIN_PATH,
  STUDENT_AUTH_LOGOUT_PATH,
  STUDENT_AUTH_SESSION_PATH,
  adminStudentEnrollmentCodePath,
  adminStudentResetCodePath,
  adminStudentRevokeSessionsPath,
} from "@blocksync/classroom-access";
import {studentAuthMethodIncludesLocal} from "@blocksync/classroom-access";
import type Database from "better-sqlite3";
import {
  readAdminSession,
  requireAdminCsrf,
  type AdminAuthConfig,
  type AdminSessionStore,
} from "./admin-auth.js";
import {readStudentGrantId} from "./student-grant.js";
import {
  activateStudentAccount,
  buildIdentityCookieToken,
  clearStudentIdentityCookie,
  getGrantStudentAuthPolicy,
  loginStudentAccount,
  issueEnrollmentCode,
  readIdentitySigningSecret,
  readStudentIdentityToken,
  resetStudentPassphraseFlow,
  resolveGrantContext,
  resolveStudentIdentitySession,
  revokeStudentIdentitySessions,
  setStudentIdentityCookie,
  STUDENT_IDENTITY_TTL_MS,
} from "./student-auth.js";

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

async function readJsonBody(
  req: IncomingMessage,
  limit = 32 * 1024,
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

function parseAdminStudentAuthPath(urlPath: string): {
  studentId: string;
  action: "enrollment-code" | "reset-code" | "sessions-revoke";
} | null {
  const path = pathOnly(urlPath);
  const enrollmentMatch = /^\/api\/admin\/students\/([^/]+)\/enrollment-code$/.exec(
    path,
  );
  if (enrollmentMatch) {
    return {
      studentId: decodeURIComponent(enrollmentMatch[1] ?? ""),
      action: "enrollment-code",
    };
  }
  const resetMatch = /^\/api\/admin\/students\/([^/]+)\/reset-code$/.exec(path);
  if (resetMatch) {
    return {
      studentId: decodeURIComponent(resetMatch[1] ?? ""),
      action: "reset-code",
    };
  }
  const revokeMatch =
    /^\/api\/admin\/students\/([^/]+)\/sessions\/revoke$/.exec(path);
  if (revokeMatch) {
    return {
      studentId: decodeURIComponent(revokeMatch[1] ?? ""),
      action: "sessions-revoke",
    };
  }
  return null;
}

export function isStudentAuthPath(urlPath: string): boolean {
  const path = pathOnly(urlPath);
  return (
    path === STUDENT_AUTH_ACTIVATE_PATH ||
    path === STUDENT_AUTH_LOGIN_PATH ||
    path === STUDENT_AUTH_SESSION_PATH ||
    path === STUDENT_AUTH_LOGOUT_PATH ||
    parseAdminStudentAuthPath(path) !== null
  );
}

export interface CreateStudentAuthRoutesHandlerOptions {
  enabled: boolean;
  db: Database.Database;
  adminConfig: AdminAuthConfig | null;
  adminSessions: AdminSessionStore;
  identitySigningSecret?: string;
  cookieSecure?: boolean;
  now?: () => number;
}

export function createStudentAuthRoutesHandler(
  options: CreateStudentAuthRoutesHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const now = () => (options.now ? options.now() : Date.now());
  const cookieSecure =
    options.cookieSecure ??
    options.adminConfig?.cookieSecure ??
    process.env.NODE_ENV === "production";

  return async (req, res) => {
    const urlPath = pathOnly(req.url ?? "/");
    if (!isStudentAuthPath(urlPath)) return false;

    if (!options.enabled) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
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
        message: "Student auth is not configured",
      });
      return true;
    }

    const adminRoute = parseAdminStudentAuthPath(urlPath);
    if (adminRoute) {
      if (req.method !== "POST") {
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
        return true;
      }
      if (!options.adminConfig) {
        sendJson(res, 503, {
          ok: false,
          code: "NOT_CONFIGURED",
          message: "Admin auth is not configured",
        });
        return true;
      }
      const adminSession = readAdminSession(req, options.adminSessions, now());
      if (!adminSession) {
        sendJson(res, 401, {ok: false, code: "UNAUTHORIZED"});
        return true;
      }
      if (!requireAdminCsrf(req, adminSession)) {
        sendJson(res, 403, {ok: false, code: "CSRF"});
        return true;
      }

      if (adminRoute.action === "enrollment-code") {
        const issued = await issueEnrollmentCode(options.db, {
          studentId: adminRoute.studentId,
          ownerAdminId: adminSession.adminId,
        });
        if (!issued) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          enrollmentCode: issued.enrollmentCode,
          expiresAt: issued.expiresAt,
        });
        return true;
      }

      if (adminRoute.action === "reset-code") {
        const issued = await resetStudentPassphraseFlow(options.db, {
          studentId: adminRoute.studentId,
          ownerAdminId: adminSession.adminId,
        });
        if (!issued) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          enrollmentCode: issued.enrollmentCode,
          expiresAt: issued.expiresAt,
        });
        return true;
      }

      if (adminRoute.action === "sessions-revoke") {
        const revoked = revokeStudentIdentitySessions(options.db, {
          studentId: adminRoute.studentId,
          ownerAdminId: adminSession.adminId,
        });
        if (!revoked) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
          return true;
        }
        sendJson(res, 200, {ok: true});
        return true;
      }
    }

    if (urlPath === STUDENT_AUTH_SESSION_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
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
      const session = resolveStudentIdentitySession(options.db, {
        grantId,
        identityToken: readStudentIdentityToken(req),
        signingSecret,
        nowMs: now(),
      });
      if (!session) {
        sendJson(res, 401, {
          ok: false,
          code: "IDENTITY_REQUIRED",
          authenticated: false,
        });
        return true;
      }
      sendJson(res, 200, {ok: true, ...session});
      return true;
    }

    if (urlPath === STUDENT_AUTH_LOGOUT_PATH) {
      if (req.method !== "POST") {
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
        return true;
      }
      clearStudentIdentityCookie(res, cookieSecure);
      sendJson(res, 200, {ok: true});
      return true;
    }

    if (urlPath !== STUDENT_AUTH_ACTIVATE_PATH && urlPath !== STUDENT_AUTH_LOGIN_PATH) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
      return true;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
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

    const grant = resolveGrantContext(options.db, grantId);
    if (!grant) {
      sendJson(res, 401, {
        ok: false,
        code: "GRANT_REQUIRED",
        message: "Grant required",
      });
      return true;
    }

    const authPolicy = getGrantStudentAuthPolicy(options.db, grantId);
    if (!authPolicy || !studentAuthMethodIncludesLocal(authPolicy.method)) {
      sendJson(res, 403, {
        ok: false,
        code: "FORBIDDEN",
        message: "Local login is not enabled for this classroom",
      });
      return true;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, {ok: false, code: "BAD_REQUEST"});
      return true;
    }

    const nowMs = now();
    let result;
    if (urlPath === STUDENT_AUTH_ACTIVATE_PATH) {
      const enrollmentCode =
        body &&
        typeof body === "object" &&
        typeof (body as {enrollmentCode?: unknown}).enrollmentCode === "string"
          ? (body as {enrollmentCode: string}).enrollmentCode
          : "";
      const passphrase =
        body &&
        typeof body === "object" &&
        typeof (body as {passphrase?: unknown}).passphrase === "string"
          ? (body as {passphrase: string}).passphrase
          : "";
      result = await activateStudentAccount(options.db, {
        grant,
        enrollmentCode,
        passphrase,
        signingSecret,
        nowMs,
      });
    } else {
      const loginName =
        body &&
        typeof body === "object" &&
        typeof (body as {loginName?: unknown}).loginName === "string"
          ? (body as {loginName: string}).loginName
          : "";
      const passphrase =
        body &&
        typeof body === "object" &&
        typeof (body as {passphrase?: unknown}).passphrase === "string"
          ? (body as {passphrase: string}).passphrase
          : "";
      result = await loginStudentAccount(options.db, {
        grant,
        loginName,
        passphrase,
        nowMs,
      });
    }

    if (!result.ok) {
      const status = result.code === "BAD_REQUEST" ? 400 : 401;
      sendJson(res, status, result);
      return true;
    }

    const token = buildIdentityCookieToken(result, signingSecret);
    const maxAgeSeconds = Math.max(
      0,
      Math.floor((result.identityExpiresAtMs - nowMs) / 1000),
    );
    setStudentIdentityCookie(res, token, {
      secure: cookieSecure,
      maxAgeSeconds: maxAgeSeconds || Math.floor(STUDENT_IDENTITY_TTL_MS / 1000),
    });
    sendJson(res, 200, {
      ok: true,
      studentId: result.studentId,
      displayName: result.displayName,
      loginName: result.loginName,
    });
    return true;
  };
}

export {
  adminStudentEnrollmentCodePath,
  adminStudentResetCodePath,
  adminStudentRevokeSessionsPath,
};
