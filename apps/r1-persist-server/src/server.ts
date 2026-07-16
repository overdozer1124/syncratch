/**
 * @experimental R1 persistence HTTP API (Hono).
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthContext } from "@blocksync/auth-context";
import type { ProjectService } from "@blocksync/project-service";
import {
  AssetIntegrityError,
  AssetNotGrantedError,
  AssetNotLiveError,
  BadRequestError,
  ForbiddenError,
  ImportPreconditionError,
  NotFoundError,
  SchemaInvalidError,
  SchemaVersionMismatchError,
  SnapshotHashMismatchError,
  StaleRevisionError,
  TransactionPayloadMismatchError,
  UnauthorizedError,
} from "@blocksync/project-service";
import type { LiveAssetCatalog } from "@blocksync/project-service";
import type { AssetFsStore } from "@blocksync/project-assets-fs";
import {
  GlobalDiskExceededError,
  OrgQuotaExceededError,
  ReservationCapacityExceededError,
  ReservationNotFoundError,
  StaleFileBytesError,
  type AssetRepository,
} from "@blocksync/project-store-sqlite";
import {
  AuthFailedError,
  UnauthenticatedError,
  type AuthRepository,
  type SessionService,
} from "@blocksync/session-service";
import type { AuthMode } from "./auth-config.js";
import { createCorsMiddleware } from "./cors.js";
import {
  buildCsrfClearCookie,
  buildCsrfSetCookie,
  buildSessionClearCookie,
  buildSessionSetCookie,
  CSRF_COOKIE_NAME,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
} from "./cookies.js";
import { assertCsrf } from "./csrf.js";
import {
  MAX_BODY_BYTES,
  MAX_PROJECT_ID_LENGTH,
  MAX_REVISION,
  MAX_SB3_UPLOAD_BYTES,
  MAX_SNAPSHOT_ID_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TRANSACTION_ID_LENGTH,
  SHA256_HEX,
} from "./limits.js";
import { assertOriginAllowed } from "./origin.js";
import type { R1DataLayout } from "./data-dir.js";
import { assertHeadReferencesSha, exportSb3ForProject } from "./export-sb3.js";
import { importSb3FromHttpRequest } from "./import-sb3.js";
import type { LoadSb3IsolatedOptions } from "@blocksync/sb3-tools";

export interface Sb3HttpDeps {
  assetRepo: AssetRepository;
  assetFs: AssetFsStore;
  dataLayout: R1DataLayout;
  liveCatalog: LiveAssetCatalog;
  idFactory?: () => string;
  isolatedOptions?: LoadSb3IsolatedOptions;
}

export interface CreateServerDeps {
  auth: AuthContext;
  service: ProjectService;
  /** Defaults to stub — no Origin/CSRF/auth routes. */
  authMode?: AuthMode;
  allowedOrigins?: string[];
  cookieSecure?: boolean;
  /** Required when authMode === "google". */
  sessionService?: SessionService;
  /** Required when authMode === "google" (CSRF hash check). */
  authRepo?: AuthRepository;
  hash?: (raw: string) => string;
  sessionMaxAgeSec?: number;
  sb3?: Sb3HttpDeps;
}

function headersFromRequest(c: {
  req: { header: (name: string) => string | undefined };
}) {
  const cookies = parseCookieHeader(c.req.header("cookie"));
  return {
    headers: {
      "x-user-id": c.req.header("x-user-id"),
      "x-organization-id": c.req.header("x-organization-id"),
    },
    cookies: {
      [SESSION_COOKIE_NAME]: cookies[SESSION_COOKIE_NAME],
      [CSRF_COOKIE_NAME]: cookies[CSRF_COOKIE_NAME],
    },
  };
}

/** Public-facing auth failures must not reveal which session state failed. */
const PUBLIC_UNAUTHORIZED = {
  status: 401 as const,
  body: { code: "UNAUTHORIZED", message: "Unauthorized" },
};
const PUBLIC_AUTH_FAILED = {
  status: 401 as const,
  body: { code: "AUTH_FAILED", message: "Authentication failed" },
};

function mapError(
  err: unknown,
): { status: number; body: { code: string; message: string } } {
  if (err instanceof AuthFailedError) {
    return { ...PUBLIC_AUTH_FAILED };
  }
  if (err instanceof UnauthenticatedError) {
    return { ...PUBLIC_UNAUTHORIZED };
  }
  if (err instanceof BadRequestError) {
    return { status: 400, body: { code: err.code, message: err.message } };
  }
  if (err instanceof UnauthorizedError) {
    return {
      status: 401,
      body: { code: err.code, message: "Unauthorized" },
    };
  }
  if (err instanceof ForbiddenError) {
    return { status: 403, body: { code: err.code, message: err.message } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { code: err.code, message: err.message } };
  }
  if (
    err instanceof StaleRevisionError ||
    err instanceof TransactionPayloadMismatchError
  ) {
    return { status: 409, body: { code: err.code, message: err.message } };
  }
  if (
    err instanceof SchemaInvalidError ||
    err instanceof SchemaVersionMismatchError ||
    err instanceof SnapshotHashMismatchError
  ) {
    return { status: 422, body: { code: err.code, message: err.message } };
  }
  if (
    err instanceof AssetNotLiveError ||
    err instanceof AssetNotGrantedError ||
    err instanceof AssetIntegrityError ||
    err instanceof ImportPreconditionError
  ) {
    return { status: 422, body: { code: err.code, message: err.message } };
  }
  if (
    err instanceof GlobalDiskExceededError ||
    err instanceof OrgQuotaExceededError ||
    err instanceof ReservationCapacityExceededError ||
    err instanceof StaleFileBytesError
  ) {
    return { status: 507, body: { code: err.name, message: err.message } };
  }
  if (err instanceof ReservationNotFoundError) {
    return { status: 409, body: { code: err.name, message: err.message } };
  }
  const message = err instanceof Error ? err.message : "INTERNAL";
  return { status: 500, body: { code: "INTERNAL", message } };
}

async function readJsonBody<T>(c: {
  req: { json: () => Promise<unknown> };
}): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new BadRequestError("Malformed JSON body");
  }
}

function assertTitle(title: unknown): string {
  if (typeof title !== "string" || title.length === 0) {
    throw new BadRequestError("title required");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new BadRequestError(`title exceeds ${MAX_TITLE_LENGTH} characters`);
  }
  return title;
}

function assertTransactionId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new BadRequestError("transactionId required");
  }
  if (id.length > MAX_TRANSACTION_ID_LENGTH) {
    throw new BadRequestError(
      `transactionId exceeds ${MAX_TRANSACTION_ID_LENGTH} characters`,
    );
  }
  return id;
}

function assertRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequestError(`${field} must be a non-negative integer`);
  }
  if (value > MAX_REVISION) {
    throw new BadRequestError(`${field} out of range`);
  }
  return value;
}

function assertId(value: string, field: string, max: number): string {
  if (!value || value.length > max) {
    throw new BadRequestError(`invalid ${field}`);
  }
  return value;
}

function isJsonContentType(ct: string | undefined): boolean {
  if (!ct) return false;
  const base = ct.split(";")[0]?.trim().toLowerCase();
  return base === "application/json";
}

export function createPersistApp(deps: CreateServerDeps): Hono {
  const authMode = deps.authMode ?? "stub";
  const allowedOrigins = deps.allowedOrigins ?? [];
  const cookieSecure = deps.cookieSecure ?? false;
  const maxAgeSec = deps.sessionMaxAgeSec ?? SESSION_MAX_AGE_SEC;
  const google = authMode === "google";

  if (google) {
    if (!deps.sessionService) {
      throw new Error("sessionService is required in google mode");
    }
    if (!deps.authRepo) {
      throw new Error("authRepo is required in google mode");
    }
    if (!deps.hash) {
      throw new Error("hash is required in google mode");
    }
    if (allowedOrigins.length === 0) {
      throw new Error("allowedOrigins required in google mode");
    }
  }

  const app = new Hono();

  if (google) {
    app.use("*", createCorsMiddleware(allowedOrigins));
  }

  app.onError((err, c) => {
    if (err instanceof UnauthenticatedError || err instanceof AuthFailedError) {
      console.warn(`auth_reject class=${err.name} reason=${err.message}`);
    }
    const mapped = mapError(err);
    return c.json(mapped.body, mapped.status as 400);
  });

  const guardMutation = (c: {
    req: { header: (name: string) => string | undefined };
  }) => {
    if (!google) return;
    assertOriginAllowed(c.req.header("origin"), allowedOrigins);
    assertCsrf({
      cookies: parseCookieHeader(c.req.header("cookie")),
      csrfHeader: c.req.header("x-csrf-token"),
      authRepo: deps.authRepo!,
      hash: deps.hash!,
    });
  };

  if (deps.sb3) {
    const sb3 = deps.sb3;
    app.post("/v1/projects/import", async (c) => {
      guardMutation(c);
      const envelope = await importSb3FromHttpRequest(
        {
          auth: deps.auth,
          assetRepo: sb3.assetRepo,
          assetFs: sb3.assetFs,
          dataLayout: sb3.dataLayout,
          service: deps.service,
          idFactory: sb3.idFactory,
          isolatedOptions: sb3.isolatedOptions,
        },
        headersFromRequest(c),
        c.req.raw,
      );
      return c.json(envelope, 201);
    });

    app.get("/v1/projects/:id/export.sb3", async (c) => {
      const projectId = assertId(c.req.param("id"), "projectId", MAX_PROJECT_ID_LENGTH);
      const zip = await exportSb3ForProject(
        {
          service: deps.service,
          assetFs: sb3.assetFs,
          liveCatalog: sb3.liveCatalog,
        },
        headersFromRequest(c),
        projectId,
      );
      return new Response(Buffer.from(zip), {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${projectId}.sb3"`,
          "x-content-type-options": "nosniff",
        },
      });
    });

    app.get("/v1/projects/:id/assets/:sha256", async (c) => {
      const projectId = assertId(c.req.param("id"), "projectId", MAX_PROJECT_ID_LENGTH);
      const sha256 = c.req.param("sha256");
      if (!SHA256_HEX.test(sha256)) {
        throw new BadRequestError("invalid sha256");
      }
      const envelope = await deps.service.getProject(headersFromRequest(c), projectId);
      assertHeadReferencesSha(envelope.document, sha256);
      const record = sb3.liveCatalog.getAsset(sha256);
      if (!record || record.gcState !== "live") {
        throw new AssetNotLiveError(sha256);
      }
      if (!sb3.liveCatalog.hasOrgGrant(envelope.organizationId, sha256)) {
        throw new AssetNotGrantedError(sha256);
      }
      const bytes = sb3.assetFs.getLive(sha256);
      if (!bytes) {
        throw new AssetIntegrityError(sha256, "MISSING_BYTES");
      }
      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${sha256}"`,
          "x-content-type-options": "nosniff",
        },
      });
    });
  }

  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          { code: "BAD_REQUEST", message: `Body exceeds ${MAX_BODY_BYTES} bytes` },
          400,
        ),
    }),
  );

  if (google) {
    const sessionService = deps.sessionService!;
    const authRepo = deps.authRepo!;
    const hashFn = deps.hash!;

    app.post("/v1/auth/google", async (c) => {
      assertOriginAllowed(c.req.header("origin"), allowedOrigins);
      if (!isJsonContentType(c.req.header("content-type"))) {
        throw new BadRequestError("Content-Type must be application/json");
      }
      const body = await readJsonBody<{ idToken?: unknown }>(c);
      if (typeof body.idToken !== "string" || body.idToken.length === 0) {
        throw new BadRequestError("idToken required");
      }
      const result = await sessionService.loginWithGoogleIdToken(body.idToken);
      const headers = new Headers({ "content-type": "application/json" });
      headers.append(
        "Set-Cookie",
        buildSessionSetCookie(result.rawSessionId, {
          secure: cookieSecure,
          maxAgeSec,
        }),
      );
      headers.append(
        "Set-Cookie",
        buildCsrfSetCookie(result.rawCsrfToken, {
          secure: cookieSecure,
          maxAgeSec,
        }),
      );
      return new Response(
        JSON.stringify({
          user: {
            id: result.userId,
            organizationId: result.organizationId,
            email: result.email,
          },
          expiresAt: result.expiresAt,
        }),
        { status: 200, headers },
      );
    });

    app.get("/v1/auth/me", async (c) => {
      let principal;
      try {
        principal = await deps.auth.resolve(headersFromRequest(c));
      } catch (err) {
        if (err instanceof UnauthenticatedError) throw err;
        throw new UnauthorizedError();
      }
      const cookies = parseCookieHeader(c.req.header("cookie"));
      const rawSession = cookies[SESSION_COOKIE_NAME];
      if (!rawSession) throw new UnauthenticatedError();
      const row = authRepo.withTransaction((tx) =>
        tx.getSessionByHash(hashFn(rawSession)),
      );
      if (!row) throw new UnauthenticatedError();
      return c.json({
        user: {
          id: principal.userId,
          organizationId: principal.organizationId,
          displayName: principal.displayName ?? null,
        },
        expiresAt: row.expiresAt,
      });
    });

    app.post("/v1/auth/logout", async (c) => {
      guardMutation(c);
      const cookies = parseCookieHeader(c.req.header("cookie"));
      const rawSession = cookies[SESSION_COOKIE_NAME];
      if (rawSession) {
        sessionService.logout(hashFn(rawSession));
      }
      const headers = new Headers();
      headers.append("Set-Cookie", buildSessionClearCookie(cookieSecure));
      headers.append("Set-Cookie", buildCsrfClearCookie(cookieSecure));
      return new Response(null, { status: 204, headers });
    });
  }

  app.post("/v1/projects", async (c) => {
    guardMutation(c);
    const body = await readJsonBody<{ title?: string; projectId?: string }>(c);
    const title = assertTitle(body.title);
    if (body.projectId !== undefined) {
      if (typeof body.projectId !== "string") {
        throw new BadRequestError("invalid projectId");
      }
      assertId(body.projectId, "projectId", MAX_PROJECT_ID_LENGTH);
    }
    const envelope = await deps.service.createProject(headersFromRequest(c), {
      title,
      projectId: body.projectId,
    });
    return c.json(envelope, 201);
  });

  app.get("/v1/projects", async (c) => {
    const list = await deps.service.listProjects(headersFromRequest(c));
    return c.json({ projects: list });
  });

  app.get("/v1/projects/:id", async (c) => {
    const projectId = assertId(c.req.param("id"), "projectId", MAX_PROJECT_ID_LENGTH);
    const envelope = await deps.service.getProject(
      headersFromRequest(c),
      projectId,
    );
    return c.json(envelope);
  });

  app.put("/v1/projects/:id/document", async (c) => {
    guardMutation(c);
    const projectId = assertId(c.req.param("id"), "projectId", MAX_PROJECT_ID_LENGTH);
    const body = await readJsonBody<{
      baseRevision?: number;
      transactionId?: string;
      schemaVersion?: number;
      document?: unknown;
    }>(c);
    if (body.document === undefined || body.document === null) {
      throw new BadRequestError("document required");
    }
    if (typeof body.schemaVersion !== "number") {
      throw new BadRequestError("schemaVersion required");
    }
    const envelope = await deps.service.saveDocument(headersFromRequest(c), {
      projectId,
      baseRevision: assertRevision(body.baseRevision, "baseRevision"),
      transactionId: assertTransactionId(body.transactionId),
      schemaVersion: body.schemaVersion,
      document: body.document as never,
    });
    return c.json(envelope);
  });

  app.post("/v1/projects/:id/snapshots", async (c) => {
    guardMutation(c);
    const projectId = assertId(c.req.param("id"), "projectId", MAX_PROJECT_ID_LENGTH);
    let reason: string | undefined;
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await readJsonBody<{ reason?: string }>(c);
      if (body.reason !== undefined && typeof body.reason !== "string") {
        throw new BadRequestError("invalid reason");
      }
      reason = body.reason;
    }
    const meta = await deps.service.createSnapshot(headersFromRequest(c), {
      projectId,
      reason,
    });
    return c.json(meta, 201);
  });

  app.get("/v1/projects/:id/snapshots", async (c) => {
    const projectId = assertId(c.req.param("id"), "projectId", MAX_PROJECT_ID_LENGTH);
    const list = await deps.service.listSnapshots(
      headersFromRequest(c),
      projectId,
    );
    return c.json({ snapshots: list });
  });

  app.post("/v1/projects/:id/restore", async (c) => {
    guardMutation(c);
    const projectId = assertId(c.req.param("id"), "projectId", MAX_PROJECT_ID_LENGTH);
    const body = await readJsonBody<{
      snapshotId?: string;
      baseRevision?: number;
      transactionId?: string;
      schemaVersion?: number;
    }>(c);
    if (typeof body.snapshotId !== "string") {
      throw new BadRequestError("snapshotId required");
    }
    assertId(body.snapshotId, "snapshotId", MAX_SNAPSHOT_ID_LENGTH);
    if (typeof body.schemaVersion !== "number") {
      throw new BadRequestError("schemaVersion required");
    }
    const envelope = await deps.service.restoreSnapshot(headersFromRequest(c), {
      projectId,
      snapshotId: body.snapshotId,
      baseRevision: assertRevision(body.baseRevision, "baseRevision"),
      transactionId: assertTransactionId(body.transactionId),
      schemaVersion: body.schemaVersion,
    });
    return c.json(envelope);
  });

  return app;
}
