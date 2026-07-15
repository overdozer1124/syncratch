/**
 * @experimental R1 persistence HTTP API (Hono).
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthContext } from "@blocksync/auth-context";
import type { ProjectService } from "@blocksync/project-service";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  SchemaInvalidError,
  SchemaVersionMismatchError,
  StaleRevisionError,
  TransactionPayloadMismatchError,
  UnauthorizedError,
} from "@blocksync/project-service";
import {
  MAX_BODY_BYTES,
  MAX_PROJECT_ID_LENGTH,
  MAX_REVISION,
  MAX_SNAPSHOT_ID_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TRANSACTION_ID_LENGTH,
} from "./limits.js";

export interface CreateServerDeps {
  auth: AuthContext;
  service: ProjectService;
}

function headersFromRequest(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return {
    headers: {
      "x-user-id": c.req.header("x-user-id"),
      "x-organization-id": c.req.header("x-organization-id"),
    },
  };
}

function mapError(
  err: unknown,
): { status: number; body: { code: string; message: string } } {
  if (err instanceof BadRequestError) {
    return { status: 400, body: { code: err.code, message: err.message } };
  }
  if (err instanceof UnauthorizedError) {
    return { status: 401, body: { code: err.code, message: err.message } };
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
    err instanceof SchemaVersionMismatchError
  ) {
    return { status: 422, body: { code: err.code, message: err.message } };
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

export function createPersistApp(deps: CreateServerDeps): Hono {
  const app = new Hono();

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

  app.onError((err, c) => {
    const mapped = mapError(err);
    return c.json(mapped.body, mapped.status as 400);
  });

  app.post("/v1/projects", async (c) => {
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
