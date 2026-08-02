/**
 * Classroom policy / student-link HTTP API + public student policy resolve.
 */
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  ADMIN_API_PREFIX,
  ADMIN_LINKS_PATH,
  ADMIN_POLICIES_PATH,
  STUDENT_GRANT_PATH,
  STUDENT_POLICY_BY_TOKEN_PREFIX,
  STUDENT_POLICY_PATH,
  isLinkExpiresAtInPast,
  isPlausibleStudentToken,
  parseLinkExpiresAt,
  studentSurfacePath,
  type ClassroomPolicyInput,
} from "@blocksync/classroom-access";
import type {AdminDb} from "./admin-db.js";
import {
  type AdminAuthConfig,
  type AdminSessionStore,
  createMemoryAdminSessionStore,
  readAdminSession,
  requireAdminCsrf,
} from "./admin-auth.js";
import {
  clearStudentGrantCookie,
  readStudentGrantId,
  setStudentGrantCookie,
  STUDENT_GRANT_TTL_MS,
} from "./student-grant.js";

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

export interface CreateAdminApiHandlerOptions {
  db: AdminDb;
  config: AdminAuthConfig | null;
  sessions?: AdminSessionStore;
  /** When true, student grant cookie gets Secure flag (production). */
  studentGrantCookieSecure?: boolean;
}

export function createAdminApiHandler(
  options: CreateAdminApiHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const sessions = options.sessions ?? createMemoryAdminSessionStore();
  const grantCookieSecure =
    options.studentGrantCookieSecure ??
    options.config?.cookieSecure ??
    process.env.NODE_ENV === "production";

  return async (req, res) => {
    const urlPath = pathOnly(req.url ?? "/");

    if (urlPath === STUDENT_GRANT_PATH) {
      if (req.method !== "POST") {
        sendJson(res, 405, {
          ok: false,
          code: "METHOD_NOT_ALLOWED",
          message: "POST required",
        });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {ok: false, code: "BAD_REQUEST", message: "JSON required"});
        return true;
      }
      const token =
        body &&
        typeof body === "object" &&
        typeof (body as {token?: unknown}).token === "string"
          ? (body as {token: string}).token.trim()
          : "";
      if (!isPlausibleStudentToken(token)) {
        sendJson(res, 404, {
          ok: false,
          code: "LINK_NOT_FOUND",
          message: "このリンクは使えません。",
        });
        return true;
      }
      const grant = options.db.createStudentGrant(token);
      if (!grant) {
        sendJson(res, 404, {
          ok: false,
          code: "LINK_NOT_FOUND",
          message: "このリンクは使えません。",
        });
        return true;
      }
      setStudentGrantCookie(res, grant.grantId, {
        secure: grantCookieSecure,
        maxAgeSeconds: Math.floor(STUDENT_GRANT_TTL_MS / 1000),
      });
      sendJson(res, 200, {ok: true});
      return true;
    }

    if (urlPath === STUDENT_POLICY_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, {
          ok: false,
          code: "METHOD_NOT_ALLOWED",
          message: "GET required",
        });
        return true;
      }
      const grantId = readStudentGrantId(req);
      if (!grantId) {
        sendJson(res, 401, {
          ok: false,
          code: "GRANT_REQUIRED",
          message: "このリンクは使えません。",
        });
        return true;
      }
      const policy = options.db.resolveStudentPolicyByGrant(grantId);
      if (!policy) {
        clearStudentGrantCookie(res, grantCookieSecure);
        sendJson(res, 404, {
          ok: false,
          code: "LINK_NOT_FOUND",
          message: "このリンクは使えません。",
        });
        return true;
      }
      sendJson(res, 200, {ok: true, policy});
      return true;
    }

    if (urlPath.startsWith(`${STUDENT_POLICY_BY_TOKEN_PREFIX}/`)) {
      if (req.method !== "GET") {
        sendJson(res, 405, {
          ok: false,
          code: "METHOD_NOT_ALLOWED",
          message: "GET required",
        });
        return true;
      }
      const token = decodeURIComponent(
        urlPath.slice(`${STUDENT_POLICY_BY_TOKEN_PREFIX}/`.length),
      );
      if (!isPlausibleStudentToken(token)) {
        sendJson(res, 404, {
          ok: false,
          code: "LINK_NOT_FOUND",
          message: "このリンクは使えません。",
        });
        return true;
      }
      const policy = options.db.resolveStudentPolicy(token);
      if (!policy) {
        sendJson(res, 404, {
          ok: false,
          code: "LINK_NOT_FOUND",
          message: "このリンクは使えません。",
        });
        return true;
      }
      sendJson(res, 200, {ok: true, policy});
      return true;
    }

    if (!urlPath.startsWith(ADMIN_API_PREFIX)) return false;
    // Auth routes are handled elsewhere.
    if (
      urlPath.startsWith(`${ADMIN_API_PREFIX}/auth`) ||
      urlPath === `${ADMIN_API_PREFIX}/me`
    ) {
      return false;
    }

    if (!options.config) {
      sendJson(res, 503, {
        ok: false,
        code: "ADMIN_AUTH_NOT_CONFIGURED",
        message: "管理者 API が未設定です。",
      });
      return true;
    }

    const session = readAdminSession(req, sessions, options.config.now?.());
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        code: "UNAUTHORIZED",
        message: "ログインが必要です。",
      });
      return true;
    }
    if (!requireAdminCsrf(req, session)) {
      sendJson(res, 403, {
        ok: false,
        code: "CSRF",
        message: "CSRF token mismatch",
      });
      return true;
    }

    if (urlPath === ADMIN_POLICIES_PATH && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        policies: options.db.listPolicies(session.adminId),
      });
      return true;
    }

    if (urlPath === ADMIN_POLICIES_PATH && req.method === "POST") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {ok: false, code: "BAD_REQUEST", message: "JSON required"});
        return true;
      }
      const input = (body ?? {}) as ClassroomPolicyInput;
      const policy = options.db.createPolicy(session.adminId, input);
      sendJson(res, 201, {ok: true, policy});
      return true;
    }

    const policyMatch = /^\/api\/admin\/policies\/([^/]+)$/.exec(urlPath);
    if (policyMatch) {
      const policyId = decodeURIComponent(policyMatch[1] ?? "");
      if (req.method === "GET") {
        const policy = options.db.getPolicy(policyId, session.adminId);
        if (!policy) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND", message: "policy not found"});
          return true;
        }
        sendJson(res, 200, {ok: true, policy});
        return true;
      }
      if (req.method === "PATCH") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendJson(res, 400, {ok: false, code: "BAD_REQUEST", message: "JSON required"});
          return true;
        }
        const policy = options.db.updatePolicy(
          policyId,
          session.adminId,
          (body ?? {}) as ClassroomPolicyInput,
        );
        if (!policy) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND", message: "policy not found"});
          return true;
        }
        sendJson(res, 200, {ok: true, policy});
        return true;
      }
    }

    const policyLinksMatch =
      /^\/api\/admin\/policies\/([^/]+)\/links$/.exec(urlPath);
    if (policyLinksMatch) {
      const policyId = decodeURIComponent(policyLinksMatch[1] ?? "");
      if (req.method === "GET") {
        if (!options.db.getPolicy(policyId, session.adminId)) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND", message: "policy not found"});
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          links: options.db.listLinks(session.adminId, policyId),
        });
        return true;
      }
      if (req.method === "POST") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendJson(res, 400, {ok: false, code: "BAD_REQUEST", message: "JSON required"});
          return true;
        }
        const label =
          body &&
          typeof body === "object" &&
          typeof (body as {label?: unknown}).label === "string"
            ? (body as {label: string}).label
            : "生徒用リンク";
        const expiresRaw =
          body && typeof body === "object"
            ? (body as {expiresAt?: unknown}).expiresAt
            : undefined;
        const parsedExpiry = parseLinkExpiresAt(expiresRaw);
        if (!parsedExpiry.ok) {
          sendJson(res, 400, {
            ok: false,
            code: parsedExpiry.code,
            message: "有効期限の形式が正しくありません。",
          });
          return true;
        }
        const nowIso = new Date().toISOString();
        if (
          parsedExpiry.expiresAt &&
          isLinkExpiresAtInPast(parsedExpiry.expiresAt, nowIso)
        ) {
          sendJson(res, 400, {
            ok: false,
            code: "EXPIRES_AT_IN_PAST",
            message: "有効期限は未来の日時を指定してください。",
          });
          return true;
        }
        const link = options.db.createLink({
          ownerAdminId: session.adminId,
          policyId,
          label,
          expiresAt: parsedExpiry.expiresAt,
        });
        if (!link) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND", message: "policy not found"});
          return true;
        }
        const origin = requestOrigin(req);
        sendJson(res, 201, {
          ok: true,
          link: {
            linkId: link.linkId,
            policyId: link.policyId,
            label: link.label,
            status: link.status,
            expiresAt: link.expiresAt,
            createdAt: link.createdAt,
            revokedAt: link.revokedAt,
            token: link.token,
            studentUrl: `${origin}${studentSurfacePath(link.token)}`,
          },
        });
        return true;
      }
    }

    const revokeMatch = /^\/api\/admin\/links\/([^/]+)\/revoke$/.exec(urlPath);
    if (revokeMatch && req.method === "POST") {
      const linkId = decodeURIComponent(revokeMatch[1] ?? "");
      const link = options.db.revokeLink(linkId, session.adminId);
      if (!link) {
        sendJson(res, 404, {ok: false, code: "NOT_FOUND", message: "link not found"});
        return true;
      }
      sendJson(res, 200, {ok: true, link});
      return true;
    }

    const reissueMatch = /^\/api\/admin\/links\/([^/]+)\/reissue$/.exec(urlPath);
    if (reissueMatch && req.method === "POST") {
      const linkId = decodeURIComponent(reissueMatch[1] ?? "");
      const link = options.db.reissueLink(linkId, session.adminId);
      if (!link) {
        sendJson(res, 404, {ok: false, code: "NOT_FOUND", message: "link not found"});
        return true;
      }
      const origin = requestOrigin(req);
      sendJson(res, 200, {
        ok: true,
        link: {
          linkId: link.linkId,
          policyId: link.policyId,
          label: link.label,
          status: link.status,
          expiresAt: link.expiresAt,
          createdAt: link.createdAt,
          revokedAt: link.revokedAt,
          token: link.token,
          studentUrl: `${origin}${studentSurfacePath(link.token)}`,
        },
      });
      return true;
    }

    if (urlPath === ADMIN_LINKS_PATH && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        links: options.db.listLinks(session.adminId),
      });
      return true;
    }

    if (urlPath.startsWith(ADMIN_API_PREFIX)) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND", message: "not found"});
      return true;
    }

    return false;
  };
}
