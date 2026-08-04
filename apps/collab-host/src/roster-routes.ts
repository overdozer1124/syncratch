/**
 * Admin roster HTTP routes — gated by SYNCRATCH_CLASSROOM_ROSTER_ENABLED.
 */
import type {IncomingMessage, ServerResponse} from "node:http";
import {
  ADMIN_ROSTERS_PATH,
  adminRosterImportApplyPath,
  adminRosterImportPath,
  adminRosterImportPreviewPath,
  adminRosterImportsPath,
  adminRosterPath,
  adminRosterSheetTemplatePath,
  adminRosterStudentsPath,
  adminRosterSyncPath,
  adminRosterSyncApplyPath,
} from "@blocksync/classroom-access";
import {
  readAdminSession,
  requireAdminCsrf,
  type AdminAuthConfig,
  type AdminSessionStore,
} from "./admin-auth.js";
import {
  applySheetSync,
  createRosterService,
  createSheetSyncPreview,
  RosterServiceError,
  SheetSyncError,
  type RosterService,
  type RosterSheetSyncEnvironment,
} from "./roster-service.js";
import {createRosterTemplateSpreadsheet} from "./roster-sheet-sync.js";
import {MAX_ROSTER_CSV_BYTES} from "./roster-import.js";
import type Database from "better-sqlite3";

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

async function readBody(
  req: IncomingMessage,
  limit = MAX_ROSTER_CSV_BYTES + 4096,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(
  req: IncomingMessage,
  limit = 32 * 1024,
): Promise<unknown> {
  const raw = (await readBody(req, limit)).toString("utf8");
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

async function readCsvImportBody(
  req: IncomingMessage,
): Promise<{csv: string; deactivateMissing: boolean}> {
  const contentType = req.headers["content-type"]?.split(";")[0]?.trim() ?? "";
  if (contentType === "application/json") {
    const body = await readJsonBody(req, MAX_ROSTER_CSV_BYTES + 4096);
    if (
      body &&
      typeof body === "object" &&
      typeof (body as {csv?: unknown}).csv === "string"
    ) {
      return {
        csv: (body as {csv: string}).csv,
        deactivateMissing:
          (body as {deactivateMissing?: unknown}).deactivateMissing === true,
      };
    }
    throw new Error("JSON body must include csv string");
  }
  return {
    csv: (await readBody(req)).toString("utf8"),
    deactivateMissing: false,
  };
}

export interface ParsedRosterRoute {
  rosterId?: string;
  importId?: string;
  action:
    | "list"
    | "create"
    | "detail"
    | "students"
    | "imports"
    | "import"
    | "preview"
    | "apply"
    | "sync"
    | "sync_apply"
    | "sheet_template";
}

export function parseRosterAdminPath(urlPath: string): ParsedRosterRoute | null {
  const path = pathOnly(urlPath);
  if (path === ADMIN_ROSTERS_PATH) {
    return {action: "list"};
  }
  if (!path.startsWith(`${ADMIN_ROSTERS_PATH}/`)) return null;
  const rest = path.slice(ADMIN_ROSTERS_PATH.length + 1);
  const segments = rest.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const rosterId = decodeURIComponent(segments[0]!);
  if (segments.length === 1) {
    return {rosterId, action: "detail"};
  }
  if (segments[1] === "students" && segments.length === 2) {
    return {rosterId, action: "students"};
  }
  if (segments[1] === "sync") {
    if (segments.length === 2) {
      return {rosterId, action: "sync"};
    }
    if (segments.length === 3 && segments[2] === "apply") {
      return {rosterId, action: "sync_apply"};
    }
  }
  if (segments[1] === "sheet-template" && segments.length === 2) {
    return {rosterId, action: "sheet_template"};
  }
  if (segments[1] === "imports") {
    if (segments.length === 2) {
      return {rosterId, action: "imports"};
    }
    if (segments.length >= 3) {
      const importId = decodeURIComponent(segments[2]!);
      if (segments.length === 3) {
        return {rosterId, importId, action: "import"};
      }
      if (segments[3] === "preview" && segments.length === 4) {
        return {rosterId, importId, action: "preview"};
      }
      if (segments[3] === "apply" && segments.length === 4) {
        return {rosterId, importId, action: "apply"};
      }
    }
  }
  return null;
}

export function isRosterAdminPath(urlPath: string): boolean {
  return parseRosterAdminPath(urlPath) !== null;
}

function mapServiceError(error: unknown): {status: number; body: unknown} {
  if (error instanceof SheetSyncError) {
    switch (error.code) {
      case "CREDENTIAL_MISSING":
        return {status: 409, body: {ok: false, code: error.code, message: error.message}};
      case "CREDENTIAL_REFRESH_FAILED":
        return {status: 503, body: {ok: false, code: error.code, message: error.message}};
      case "SHEET_NOT_BOUND":
        return {status: 400, body: {ok: false, code: error.code, message: error.message}};
      case "SHEET_HEADER_INVALID":
        return {status: 422, body: {ok: false, code: error.code, message: error.message}};
      case "SHEET_TOO_LARGE":
        return {status: 413, body: {ok: false, code: error.code, message: error.message}};
      case "SHEET_INACCESSIBLE":
      case "SHEET_FETCH_FAILED":
      case "SHEET_CREATE_FAILED":
      case "SHEET_TEMPLATE_WRITE_FAILED":
        return {status: 409, body: {ok: false, code: error.code, message: error.message}};
      default:
        return {status: 400, body: {ok: false, code: error.code, message: error.message}};
    }
  }
  if (error instanceof RosterServiceError) {
    switch (error.code) {
      case "ROSTER_NOT_FOUND":
      case "IMPORT_NOT_FOUND":
        return {status: 404, body: {ok: false, code: error.code, message: error.message}};
      case "STALE_PREVIEW":
      case "REVISION_CONFLICT":
        return {status: 409, body: {ok: false, code: error.code, message: error.message}};
      case "BLOCKING_PREVIEW":
        return {status: 422, body: {ok: false, code: error.code, message: error.message}};
      case "IMPORT_NOT_APPLICABLE":
        return {status: 400, body: {ok: false, code: error.code, message: error.message}};
      case "NOT_CONFIGURED":
      case "SHEET_NOT_BOUND":
        return {status: 503, body: {ok: false, code: error.code, message: error.message}};
      default:
        return {status: 400, body: {ok: false, code: error.code, message: error.message}};
    }
  }
  if (error instanceof Error && error.message.includes("CSV exceeds")) {
    return {status: 413, body: {ok: false, code: "CSV_TOO_LARGE", message: error.message}};
  }
  if (error instanceof Error && error.message.includes("body too large")) {
    return {status: 413, body: {ok: false, code: "PAYLOAD_TOO_LARGE", message: error.message}};
  }
  return {status: 400, body: {ok: false, code: "BAD_REQUEST", message: "Invalid request"}};
}

export interface CreateRosterRoutesHandlerOptions {
  enabled: boolean;
  sheetsEnabled: boolean;
  db: Database.Database;
  adminConfig: AdminAuthConfig | null;
  adminSessions: AdminSessionStore;
  sheetSync?: RosterSheetSyncEnvironment | null;
  service?: RosterService;
  now?: () => number;
}

export function createRosterRoutesHandler(
  options: CreateRosterRoutesHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const service = options.service ?? createRosterService(options.db);
  const now = () => (options.now ? options.now() : Date.now());

  return async (req, res) => {
    const route = parseRosterAdminPath(req.url ?? "/");
    if (!route) return false;

    if (!options.enabled) {
      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
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
      sendJson(res, 401, {
        ok: false,
        code: "UNAUTHORIZED",
        message: "Admin login required",
      });
      return true;
    }

    try {
      if (route.action === "list") {
        if (req.method === "GET") {
          sendJson(res, 200, {
            ok: true,
            rosters: service.listRosters(adminSession.adminId),
          });
          return true;
        }
        if (req.method === "POST") {
          if (!requireAdminCsrf(req, adminSession)) {
            sendJson(res, 403, {ok: false, code: "CSRF", message: "CSRF token required"});
            return true;
          }
          const body = await readJsonBody(req);
          const title =
            body &&
            typeof body === "object" &&
            typeof (body as {title?: unknown}).title === "string"
              ? (body as {title: string}).title
              : undefined;
          const roster = service.createRoster(adminSession.adminId, {title});
          sendJson(res, 201, {ok: true, roster});
          return true;
        }
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
        return true;
      }

      if (!route.rosterId) {
        sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
        return true;
      }

      if (route.action === "detail") {
        if (req.method === "GET") {
          const roster = service.getRoster(route.rosterId, adminSession.adminId);
          if (!roster) {
            sendJson(res, 404, {ok: false, code: "ROSTER_NOT_FOUND"});
            return true;
          }
          sendJson(res, 200, {ok: true, roster});
          return true;
        }
        if (req.method === "PATCH") {
          if (!requireAdminCsrf(req, adminSession)) {
            sendJson(res, 403, {ok: false, code: "CSRF", message: "CSRF token required"});
            return true;
          }
          const body = (await readJsonBody(req)) as Record<string, unknown> | null;
          const roster = service.updateRoster(route.rosterId, adminSession.adminId, {
            title: typeof body?.title === "string" ? body.title : undefined,
            sheetSpreadsheetId:
              body?.sheetSpreadsheetId === null ||
              typeof body?.sheetSpreadsheetId === "string"
                ? (body.sheetSpreadsheetId as string | null)
                : undefined,
            sheetTabName:
              body?.sheetTabName === null || typeof body?.sheetTabName === "string"
                ? (body.sheetTabName as string | null)
                : undefined,
            sheetRange:
              body?.sheetRange === null || typeof body?.sheetRange === "string"
                ? (body.sheetRange as string | null)
                : undefined,
          });
          if (!roster) {
            sendJson(res, 404, {ok: false, code: "ROSTER_NOT_FOUND"});
            return true;
          }
          sendJson(res, 200, {ok: true, roster});
          return true;
        }
        sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
        return true;
      }

      if (route.action === "students") {
        if (req.method !== "GET") {
          sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
          return true;
        }
        try {
          const students = service.listStudents(route.rosterId, adminSession.adminId);
          sendJson(res, 200, {ok: true, students});
        } catch (error) {
          const mapped = mapServiceError(error);
          sendJson(res, mapped.status, mapped.body);
        }
        return true;
      }

      if (route.action === "sync") {
        if (!options.sheetsEnabled) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
          return true;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
          return true;
        }
        if (!requireAdminCsrf(req, adminSession)) {
          sendJson(res, 403, {ok: false, code: "CSRF", message: "CSRF token required"});
          return true;
        }
        if (!options.sheetSync) {
          sendJson(res, 503, {
            ok: false,
            code: "NOT_CONFIGURED",
            message: "Sheet sync is not configured",
          });
          return true;
        }
        const body = await readJsonBody(req);
        const deactivateMissing = Boolean(
          body &&
            typeof body === "object" &&
            (body as {deactivateMissing?: unknown}).deactivateMissing === true,
        );
        const preview = await createSheetSyncPreview(
          options.db,
          options.sheetSync,
          route.rosterId,
          adminSession.adminId,
          {deactivateMissing},
        );
        sendJson(res, 201, {ok: true, ...preview});
        return true;
      }

      if (route.action === "sync_apply") {
        if (!options.sheetsEnabled) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
          return true;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
          return true;
        }
        if (!requireAdminCsrf(req, adminSession)) {
          sendJson(res, 403, {ok: false, code: "CSRF", message: "CSRF token required"});
          return true;
        }
        const body = await readJsonBody(req);
        const importId =
          body &&
          typeof body === "object" &&
          typeof (body as {importId?: unknown}).importId === "string"
            ? (body as {importId: string}).importId
            : "";
        const previewHash =
          body &&
          typeof body === "object" &&
          typeof (body as {previewHash?: unknown}).previewHash === "string"
            ? (body as {previewHash: string}).previewHash
            : "";
        const baseRosterRevision =
          body &&
          typeof body === "object" &&
          typeof (body as {baseRosterRevision?: unknown}).baseRosterRevision ===
            "number"
            ? (body as {baseRosterRevision: number}).baseRosterRevision
            : NaN;
        const deactivateMissing = Boolean(
          body &&
            typeof body === "object" &&
            (body as {deactivateMissing?: unknown}).deactivateMissing === true,
        );
        if (!importId || !previewHash || !Number.isInteger(baseRosterRevision)) {
          sendJson(res, 400, {
            ok: false,
            code: "BAD_REQUEST",
            message: "importId, previewHash, and baseRosterRevision required",
          });
          return true;
        }
        const result = applySheetSync(options.db, {
          rosterId: route.rosterId,
          importId,
          ownerAdminId: adminSession.adminId,
          previewHash,
          baseRosterRevision,
          deactivateMissing,
        });
        sendJson(res, 200, {ok: true, ...result});
        return true;
      }

      if (route.action === "sheet_template") {
        if (!options.sheetsEnabled) {
          sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
          return true;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
          return true;
        }
        if (!requireAdminCsrf(req, adminSession)) {
          sendJson(res, 403, {ok: false, code: "CSRF", message: "CSRF token required"});
          return true;
        }
        if (!options.sheetSync) {
          sendJson(res, 503, {
            ok: false,
            code: "NOT_CONFIGURED",
            message: "Sheet sync is not configured",
          });
          return true;
        }
        const roster = service.getRoster(route.rosterId, adminSession.adminId);
        if (!roster) {
          sendJson(res, 404, {ok: false, code: "ROSTER_NOT_FOUND"});
          return true;
        }
        const template = await createRosterTemplateSpreadsheet(
          options.sheetSync,
          adminSession.adminId,
          roster.title,
        );
        const updated = service.updateRoster(route.rosterId, adminSession.adminId, {
          sheetSpreadsheetId: template.spreadsheetId,
          sheetTabName: template.sheetTabName,
          sheetRange: null,
        });
        sendJson(res, 201, {
          ok: true,
          template,
          roster: updated ?? roster,
        });
        return true;
      }

      if (route.action === "imports") {
        if (req.method !== "POST") {
          sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
          return true;
        }
        if (!requireAdminCsrf(req, adminSession)) {
          sendJson(res, 403, {ok: false, code: "CSRF", message: "CSRF token required"});
          return true;
        }
        const {csv: csvText, deactivateMissing} = await readCsvImportBody(req);
        const preview = service.createImportFromCsv(
          route.rosterId,
          adminSession.adminId,
          csvText,
          {deactivateMissing},
        );
        sendJson(res, 201, {ok: true, ...preview});
        return true;
      }

      if (!route.importId) {
        sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
        return true;
      }

      if (route.action === "import") {
        if (req.method !== "GET") {
          sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
          return true;
        }
        const importRecord = service.getImport(
          route.rosterId,
          route.importId,
          adminSession.adminId,
        );
        if (!importRecord) {
          sendJson(res, 404, {ok: false, code: "IMPORT_NOT_FOUND"});
          return true;
        }
        sendJson(res, 200, {ok: true, import: importRecord});
        return true;
      }

      if (route.action === "preview") {
        if (req.method !== "GET") {
          sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
          return true;
        }
        const preview = service.getImportPreview(
          route.rosterId,
          route.importId,
          adminSession.adminId,
        );
        if (!preview) {
          sendJson(res, 404, {ok: false, code: "IMPORT_NOT_FOUND"});
          return true;
        }
        sendJson(res, 200, {ok: true, ...preview});
        return true;
      }

      if (route.action === "apply") {
        if (req.method !== "POST") {
          sendJson(res, 405, {ok: false, code: "METHOD_NOT_ALLOWED"});
          return true;
        }
        if (!requireAdminCsrf(req, adminSession)) {
          sendJson(res, 403, {ok: false, code: "CSRF", message: "CSRF token required"});
          return true;
        }
        const body = await readJsonBody(req);
        const previewHash =
          body &&
          typeof body === "object" &&
          typeof (body as {previewHash?: unknown}).previewHash === "string"
            ? (body as {previewHash: string}).previewHash
            : "";
        const baseRosterRevision =
          body &&
          typeof body === "object" &&
          typeof (body as {baseRosterRevision?: unknown}).baseRosterRevision ===
            "number"
            ? (body as {baseRosterRevision: number}).baseRosterRevision
            : NaN;
        const deactivateMissing = Boolean(
          body &&
            typeof body === "object" &&
            (body as {deactivateMissing?: unknown}).deactivateMissing === true,
        );
        if (!previewHash || !Number.isInteger(baseRosterRevision)) {
          sendJson(res, 400, {
            ok: false,
            code: "BAD_REQUEST",
            message: "previewHash and baseRosterRevision required",
          });
          return true;
        }
        const result = service.applyImport({
          rosterId: route.rosterId,
          importId: route.importId,
          ownerAdminId: adminSession.adminId,
          previewHash,
          baseRosterRevision,
          deactivateMissing,
        });
        sendJson(res, 200, {ok: true, ...result});
        return true;
      }

      sendJson(res, 404, {ok: false, code: "NOT_FOUND"});
      return true;
    } catch (error) {
      const mapped = mapServiceError(error);
      sendJson(res, mapped.status, mapped.body);
      return true;
    }
  };
}

export {
  adminRosterImportApplyPath,
  adminRosterImportPath,
  adminRosterImportPreviewPath,
  adminRosterImportsPath,
  adminRosterPath,
  adminRosterSheetTemplatePath,
  adminRosterStudentsPath,
  adminRosterSyncPath,
  adminRosterSyncApplyPath,
};
