/**
 * Classroom submission HTTP routes — gated by SYNCRATCH_TEACHER_DRIVE_SUBMISSION_ENABLED.
 */
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  STUDENT_SUBMISSIONS_PATH,
  adminPolicySubmissionsPath,
  adminSubmissionContentPath,
  adminSubmissionPath,
} from "@blocksync/classroom-access";
import type Database from "better-sqlite3";
import {
  readAdminSession,
  requireAdminCsrf,
  type AdminAuthConfig,
  type AdminSessionStore,
} from "./admin-auth.js";
import {readStudentGrantId} from "./student-grant.js";
import {
  readIdentitySigningSecret,
  readStudentIdentityToken,
  resolveGrantContext,
} from "./student-auth.js";
import {
  createSubmissionService,
  SubmissionServiceError,
  readSubmissionMaxBytes,
  type SubmissionService,
} from "./submission-service.js";
import type {SubmissionDriveEnvironment} from "./submission-drive.js";

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

async function readRawBody(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      throw new SubmissionServiceError(
        "PAYLOAD_TOO_LARGE",
        "Request body too large",
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readMultipartSubmission(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{projectTitle: string; idempotencyKey: string; bytes: Buffer}> {
  const contentType = req.headers["content-type"] ?? "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!contentType.includes("multipart/form-data") || !boundaryMatch) {
    throw new SubmissionServiceError(
      "BAD_REQUEST",
      "multipart/form-data required",
    );
  }
  const boundary = boundaryMatch[1] ?? boundaryMatch[2] ?? "";
  const raw = await readRawBody(req, maxBytes + 64 * 1024);
  const body = raw.toString("latin1");
  const parts = body.split(`--${boundary}`);
  let projectTitle = "";
  let idempotencyKey = "";
  let bytes = Buffer.alloc(0);

  for (const part of parts) {
    if (!part || part.startsWith("--") || part.trim() === "") continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd);
    let content = part.slice(headerEnd + 4);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);

    const nameMatch = /name="([^"]+)"/i.exec(header);
    const fieldName = nameMatch?.[1] ?? "";
    if (fieldName === "projectTitle") {
      projectTitle = Buffer.from(content, "latin1").toString("utf8").trim();
    } else if (fieldName === "idempotencyKey") {
      idempotencyKey = Buffer.from(content, "latin1").toString("utf8").trim();
    } else if (fieldName === "sb3") {
      bytes = Buffer.from(content, "latin1");
    }
  }

  if (!idempotencyKey || bytes.length === 0) {
    throw new SubmissionServiceError(
      "BAD_REQUEST",
      "idempotencyKey and sb3 file are required",
    );
  }
  return {projectTitle, idempotencyKey, bytes};
}

function mapSubmissionError(error: unknown): {status: number; body: unknown} {
  if (error instanceof SubmissionServiceError) {
    switch (error.code) {
      case "IDENTITY_REQUIRED":
        return {status: 401, body: {ok: false, code: error.code, message: error.message}};
      case "SUBMISSION_DISABLED":
      case "SUBMISSION_NOT_CONFIGURED":
        return {status: 403, body: {ok: false, code: error.code, message: error.message}};
      case "PAYLOAD_TOO_LARGE":
        return {status: 413, body: {ok: false, code: error.code, message: error.message}};
      case "POLICY_NOT_FOUND":
        return {status: 404, body: {ok: false, code: error.code, message: error.message}};
      case "FOLDER_INACCESSIBLE":
      case "FILE_INACCESSIBLE":
      case "DRIVE_UPLOAD_FAILED":
      case "DRIVE_DOWNLOAD_FAILED":
      case "CONFLICT":
        return {status: 409, body: {ok: false, code: error.code, message: error.message}};
      default:
        return {status: 400, body: {ok: false, code: error.code, message: error.message}};
    }
  }
  return {status: 500, body: {ok: false, code: "INTERNAL_ERROR"}};
}

export interface ParsedSubmissionAdminRoute {
  action: "policy-list" | "detail" | "content";
  policyId?: string;
  submissionId?: string;
}

export function parseSubmissionAdminPath(urlPath: string): ParsedSubmissionAdminRoute | null {
  const path = pathOnly(urlPath);
  const policyMatch = /^\/api\/admin\/policies\/([^/]+)\/submissions$/.exec(path);
  if (policyMatch) {
    return {
      action: "policy-list",
      policyId: decodeURIComponent(policyMatch[1] ?? ""),
    };
  }
  const detailMatch = /^\/api\/admin\/submissions\/([^/]+)$/.exec(path);
  if (detailMatch) {
    return {
      action: "detail",
      submissionId: decodeURIComponent(detailMatch[1] ?? ""),
    };
  }
  const contentMatch = /^\/api\/admin\/submissions\/([^/]+)\/content$/.exec(path);
  if (contentMatch) {
    return {
      action: "content",
      submissionId: decodeURIComponent(contentMatch[1] ?? ""),
    };
  }
  return null;
}

export function isSubmissionPath(urlPath: string): boolean {
  const path = pathOnly(urlPath);
  return path === STUDENT_SUBMISSIONS_PATH || parseSubmissionAdminPath(path) !== null;
}

export interface CreateSubmissionRoutesHandlerOptions {
  enabled: boolean;
  db: Database.Database;
  adminConfig: AdminAuthConfig | null;
  adminSessions: AdminSessionStore;
  driveEnv?: SubmissionDriveEnvironment | null;
  identitySigningSecret?: string;
  service?: SubmissionService;
  maxBytes?: number;
}

export function createSubmissionRoutesHandler(
  options: CreateSubmissionRoutesHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const maxBytes = options.maxBytes ?? readSubmissionMaxBytes();
  const service =
    options.service ??
    createSubmissionService(options.db, options.driveEnv ?? null, maxBytes);

  return async (req, res) => {
    const urlPath = pathOnly(req.url ?? "/");
    if (!isSubmissionPath(urlPath)) return false;

    if (!options.enabled) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
      return true;
    }

    if (urlPath === STUDENT_SUBMISSIONS_PATH) {
      if (req.method !== "POST") {
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
        return true;
      }

      let signingSecret: string;
      try {
        signingSecret =
          options.identitySigningSecret ?? readIdentitySigningSecret(process.env);
      } catch {
        sendJson(res, 503, {ok: false, code: "NOT_CONFIGURED"});
        return true;
      }

      const grantId = readStudentGrantId(req);
      if (!grantId) {
        sendJson(res, 401, {ok: false, code: "GRANT_REQUIRED"});
        return true;
      }
      const grant = resolveGrantContext(options.db, grantId);
      if (!grant) {
        sendJson(res, 401, {ok: false, code: "GRANT_REQUIRED"});
        return true;
      }

      try {
        const multipart = await readMultipartSubmission(req, maxBytes);
        const result = await service.uploadStudentSubmission({
          grant,
          identityToken: readStudentIdentityToken(req) ?? "",
          signingSecret,
          idempotencyKey: multipart.idempotencyKey,
          projectTitle: multipart.projectTitle,
          bytes: multipart.bytes,
        });
        sendJson(res, result.reused ? 200 : 201, {
          ok: true,
          submission: result.submission,
          reused: result.reused,
        });
      } catch (error) {
        const mapped = mapSubmissionError(error);
        sendJson(res, mapped.status, mapped.body);
      }
      return true;
    }

    const adminRoute = parseSubmissionAdminPath(urlPath);
    if (!adminRoute) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
      return true;
    }

    if (!options.adminConfig) {
      sendJson(res, 503, {ok: false, code: "NOT_CONFIGURED"});
      return true;
    }

    const adminSession = readAdminSession(req, options.adminSessions);
    if (!adminSession) {
      sendJson(res, 401, {ok: false, code: "UNAUTHORIZED"});
      return true;
    }

    if (adminRoute.action === "policy-list") {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
        return true;
      }
      if (!adminRoute.policyId) {
        sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
        return true;
      }
      const submissions = service.listPolicySubmissions(
        adminRoute.policyId,
        adminSession.adminId,
      );
      sendJson(res, 200, {ok: true, submissions});
      return true;
    }

    if (!adminRoute.submissionId) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
      return true;
    }

    if (adminRoute.action === "detail") {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
        return true;
      }
      const submission = service.getSubmissionDetail(
        adminRoute.submissionId,
        adminSession.adminId,
      );
      if (!submission) {
        sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
        return true;
      }
      sendJson(res, 200, {ok: true, submission});
      return true;
    }

    if (adminRoute.action === "content") {
      if (req.method !== "GET") {
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
        return true;
      }
      try {
        const content = await service.streamSubmissionContent(
          adminRoute.submissionId,
          adminSession.adminId,
        );
        if (!content) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
          return true;
        }
        res.writeHead(200, {
          "content-type": "application/x.scratch.sb3",
          "content-disposition": `attachment; filename="${encodeURIComponent(content.fileName)}"`,
          "cache-control": "no-store",
        });
        res.end(content.bytes);
      } catch (error) {
        const mapped = mapSubmissionError(error);
        sendJson(res, mapped.status, mapped.body);
      }
      return true;
    }

    sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
    return true;
  };
}

export {
  adminPolicySubmissionsPath,
  adminSubmissionContentPath,
  adminSubmissionPath,
};
