/**
 * @experimental R1 persistence HTTP API (Hono).
 */

import { Hono } from "hono";
import type { AuthContext } from "@blocksync/auth-context";
import type { ProjectService } from "@blocksync/project-service";
import {
  ForbiddenError,
  NotFoundError,
  SchemaInvalidError,
  SchemaVersionMismatchError,
  StaleRevisionError,
  TransactionPayloadMismatchError,
  UnauthorizedError,
} from "@blocksync/project-service";

export interface CreateServerDeps {
  auth: AuthContext;
  service: ProjectService;
}

function headersFromRequest(c: { req: { header: (name: string) => string | undefined } }) {
  return {
    headers: {
      "x-user-id": c.req.header("x-user-id"),
      "x-organization-id": c.req.header("x-organization-id"),
    },
  };
}

function mapError(err: unknown): { status: number; body: { code: string; message: string } } {
  if (err instanceof UnauthorizedError) {
    return { status: 401, body: { code: err.code, message: err.message } };
  }
  if (err instanceof ForbiddenError) {
    return { status: 403, body: { code: err.code, message: err.message } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { code: err.code, message: err.message } };
  }
  if (err instanceof StaleRevisionError || err instanceof TransactionPayloadMismatchError) {
    return { status: 409, body: { code: err.code, message: err.message } };
  }
  if (err instanceof SchemaInvalidError || err instanceof SchemaVersionMismatchError) {
    return { status: 422, body: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : "INTERNAL";
  return { status: 500, body: { code: "INTERNAL", message } };
}

export function createPersistApp(deps: CreateServerDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    const mapped = mapError(err);
    return c.json(mapped.body, mapped.status as 400);
  });

  app.post("/v1/projects", async (c) => {
    const body = await c.req.json<{ title?: string; projectId?: string }>();
    if (!body.title || typeof body.title !== "string") {
      return c.json({ code: "BAD_REQUEST", message: "title required" }, 400);
    }
    const envelope = await deps.service.createProject(headersFromRequest(c), {
      title: body.title,
      projectId: body.projectId,
    });
    return c.json(envelope, 201);
  });

  app.get("/v1/projects", async (c) => {
    const list = await deps.service.listProjects(headersFromRequest(c));
    return c.json({ projects: list });
  });

  app.get("/v1/projects/:id", async (c) => {
    const envelope = await deps.service.getProject(
      headersFromRequest(c),
      c.req.param("id"),
    );
    return c.json(envelope);
  });

  app.put("/v1/projects/:id/document", async (c) => {
    const body = await c.req.json<{
      baseRevision?: number;
      transactionId?: string;
      schemaVersion?: number;
      document?: unknown;
    }>();
    if (
      typeof body.baseRevision !== "number" ||
      typeof body.transactionId !== "string" ||
      typeof body.schemaVersion !== "number" ||
      !body.document
    ) {
      return c.json(
        {
          code: "BAD_REQUEST",
          message: "baseRevision, transactionId, schemaVersion, document required",
        },
        400,
      );
    }
    const envelope = await deps.service.saveDocument(headersFromRequest(c), {
      projectId: c.req.param("id"),
      baseRevision: body.baseRevision,
      transactionId: body.transactionId,
      schemaVersion: body.schemaVersion,
      document: body.document as never,
    });
    return c.json(envelope);
  });

  app.post("/v1/projects/:id/snapshots", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const meta = await deps.service.createSnapshot(headersFromRequest(c), {
      projectId: c.req.param("id"),
      reason: body.reason,
    });
    return c.json(meta, 201);
  });

  app.get("/v1/projects/:id/snapshots", async (c) => {
    const list = await deps.service.listSnapshots(
      headersFromRequest(c),
      c.req.param("id"),
    );
    return c.json({ snapshots: list });
  });

  app.post("/v1/projects/:id/restore", async (c) => {
    const body = await c.req.json<{
      snapshotId?: string;
      baseRevision?: number;
      transactionId?: string;
      schemaVersion?: number;
    }>();
    if (
      typeof body.snapshotId !== "string" ||
      typeof body.baseRevision !== "number" ||
      typeof body.transactionId !== "string" ||
      typeof body.schemaVersion !== "number"
    ) {
      return c.json(
        {
          code: "BAD_REQUEST",
          message: "snapshotId, baseRevision, transactionId, schemaVersion required",
        },
        400,
      );
    }
    const envelope = await deps.service.restoreSnapshot(headersFromRequest(c), {
      projectId: c.req.param("id"),
      snapshotId: body.snapshotId,
      baseRevision: body.baseRevision,
      transactionId: body.transactionId,
      schemaVersion: body.schemaVersion,
    });
    return c.json(envelope);
  });

  return app;
}
