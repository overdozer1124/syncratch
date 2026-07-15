import { randomUUID } from "node:crypto";
import type { AuthContext, AuthPrincipal } from "@blocksync/auth-context";
import {
  PROJECT_FORMAT,
  contentHash,
  emptyDocument,
  requestHash,
  type ProjectEnvelopeV1,
} from "@blocksync/project-envelope";
import { validateProject, type ProjectDocument } from "@blocksync/project-schema";
import { DurableProjectAccessPolicy } from "./access.js";
import {
  NotFoundError,
  SchemaInvalidError,
  SchemaVersionMismatchError,
  TransactionPayloadMismatchError,
  UnauthorizedError,
} from "./errors.js";
import type {
  AuthHints,
  CreateProjectInput,
  CreateSnapshotInput,
  ProjectAccessPolicy,
  ProjectRepository,
  ProjectSummary,
  RestoreSnapshotInput,
  SaveDocumentInput,
  SnapshotMeta,
  SnapshotStore,
} from "./ports.js";

export interface ProjectServiceDeps {
  auth: AuthContext;
  access?: ProjectAccessPolicy;
  repo: ProjectRepository;
  snapshots: SnapshotStore;
  now?: () => Date;
  idFactory?: () => string;
}

async function resolveOrThrow(
  auth: AuthContext,
  hints: AuthHints,
): Promise<AuthPrincipal> {
  try {
    return await auth.resolve(hints);
  } catch {
    throw new UnauthorizedError();
  }
}

function assertSchemaMatch(schemaVersion: number, document: ProjectDocument): void {
  if (schemaVersion !== document.schemaVersion) {
    throw new SchemaVersionMismatchError();
  }
}

function assertValidDocument(document: ProjectDocument): void {
  const result = validateProject(document);
  if (!result.ok) {
    throw new SchemaInvalidError(result.issues);
  }
}

function buildEnvelope(args: {
  projectId: string;
  organizationId: string;
  title: string;
  revision: number;
  schemaVersion: number;
  document: ProjectDocument;
  updatedAt: string;
  updatedByUserId: string;
}): ProjectEnvelopeV1 {
  const hash = contentHash(args.document);
  return {
    format: PROJECT_FORMAT,
    projectId: args.projectId,
    organizationId: args.organizationId,
    title: args.title,
    revision: args.revision,
    schemaVersion: args.schemaVersion,
    contentHash: hash,
    updatedAt: args.updatedAt,
    updatedByUserId: args.updatedByUserId,
    document: args.document,
  };
}

export interface ProjectService {
  createProject(hints: AuthHints, input: CreateProjectInput): Promise<ProjectEnvelopeV1>;
  listProjects(hints: AuthHints): Promise<ProjectSummary[]>;
  getProject(hints: AuthHints, projectId: string): Promise<ProjectEnvelopeV1>;
  saveDocument(hints: AuthHints, input: SaveDocumentInput): Promise<ProjectEnvelopeV1>;
  createSnapshot(hints: AuthHints, input: CreateSnapshotInput): Promise<SnapshotMeta>;
  listSnapshots(hints: AuthHints, projectId: string): Promise<SnapshotMeta[]>;
  restoreSnapshot(
    hints: AuthHints,
    input: RestoreSnapshotInput,
  ): Promise<ProjectEnvelopeV1>;
}

export function createProjectService(deps: ProjectServiceDeps): ProjectService {
  const access = deps.access ?? new DurableProjectAccessPolicy();
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? (() => randomUUID());

  const service: ProjectService = {
    async createProject(hints, input) {
      const principal = await resolveOrThrow(deps.auth, hints);
      const projectId = input.projectId ?? idFactory();
      const document = emptyDocument();
      const updatedAt = now().toISOString();
      const envelope = buildEnvelope({
        projectId,
        organizationId: principal.organizationId,
        title: input.title,
        revision: 0,
        schemaVersion: document.schemaVersion,
        document,
        updatedAt,
        updatedByUserId: principal.userId,
      });

      return deps.repo.withTransaction((tx) =>
        tx.createProject({
          projectId,
          organizationId: principal.organizationId,
          ownerUserId: principal.userId,
          title: input.title,
          envelope,
        }),
      );
    },

    async listProjects(hints) {
      const principal = await resolveOrThrow(deps.auth, hints);
      return deps.repo.withTransaction((tx) =>
        tx.listProjectSummariesForMember(
          principal.userId,
          principal.organizationId,
        ),
      );
    },

    async getProject(hints, projectId) {
      const principal = await resolveOrThrow(deps.auth, hints);
      return deps.repo.withTransaction((tx) => {
        access.assertCan(principal, projectId, "read", tx);
        const head = tx.getHead(projectId);
        if (!head) throw new NotFoundError();
        return head;
      });
    },

    async saveDocument(hints, input) {
      const principal = await resolveOrThrow(deps.auth, hints);
      assertSchemaMatch(input.schemaVersion, input.document);
      assertValidDocument(input.document);
      const docHash = contentHash(input.document);
      const reqHash = requestHash({
        op: "save_document",
        schemaVersion: input.schemaVersion,
        contentHash: docHash,
      });

      return deps.repo.withTransaction((tx) => {
        access.assertCan(principal, input.projectId, "write", tx);
        const existing = tx.findRevisionByTransactionId(
          input.projectId,
          input.transactionId,
        );
        if (existing) {
          if (existing.requestHash !== reqHash) {
            throw new TransactionPayloadMismatchError();
          }
          return existing.envelope;
        }

        const head = tx.getHead(input.projectId);
        if (!head) throw new NotFoundError();

        const envelope = buildEnvelope({
          projectId: input.projectId,
          organizationId: head.organizationId,
          title: head.title,
          revision: input.baseRevision + 1,
          schemaVersion: input.schemaVersion,
          document: input.document,
          updatedAt: now().toISOString(),
          updatedByUserId: principal.userId,
        });

        return tx.commitRevision({
          projectId: input.projectId,
          baseRevision: input.baseRevision,
          transactionId: input.transactionId,
          envelope,
          contentHash: docHash,
          requestHash: reqHash,
        });
      });
    },

    async createSnapshot(hints, input) {
      const principal = await resolveOrThrow(deps.auth, hints);
      const head = deps.repo.withTransaction((tx) => {
        access.assertCan(principal, input.projectId, "write", tx);
        const h = tx.getHead(input.projectId);
        if (!h) throw new NotFoundError();
        return h;
      });

      assertValidDocument(head.document);
      const bytes = new TextEncoder().encode(
        JSON.stringify(head.document),
      );
      const { storageKey } = deps.snapshots.putAtomic(head.contentHash, bytes);
      const meta: SnapshotMeta = {
        snapshotId: idFactory(),
        projectId: input.projectId,
        basedOnRevision: head.revision,
        reason: input.reason ?? "manual",
        contentHash: head.contentHash,
        storageKey,
        createdBy: principal.userId,
        createdAt: now().toISOString(),
      };

      deps.repo.withTransaction((tx) => {
        access.assertCan(principal, input.projectId, "write", tx);
        tx.insertSnapshotMeta(meta);
      });
      return meta;
    },

    async listSnapshots(hints, projectId) {
      const principal = await resolveOrThrow(deps.auth, hints);
      return deps.repo.withTransaction((tx) => {
        access.assertCan(principal, projectId, "read", tx);
        return tx.listSnapshotMeta(projectId);
      });
    },

    async restoreSnapshot(hints, input) {
      const principal = await resolveOrThrow(deps.auth, hints);

      const meta = deps.repo.withTransaction((tx) => {
        access.assertCan(principal, input.projectId, "write", tx);
        const m = tx.getSnapshotMeta(input.projectId, input.snapshotId);
        if (!m) throw new NotFoundError();
        return m;
      });

      const bytes = deps.snapshots.get(meta.storageKey);
      if (!bytes) throw new NotFoundError("SNAPSHOT_BLOB_MISSING");
      const document = JSON.parse(new TextDecoder().decode(bytes)) as ProjectDocument;
      const recomputed = contentHash(document);
      if (recomputed !== meta.contentHash) {
        throw new SchemaInvalidError(
          [
            {
              code: "INVALID_DOCUMENT",
              message: "Snapshot content hash mismatch",
            },
          ],
          "SNAPSHOT_HASH_MISMATCH",
        );
      }

      return service.saveDocument(hints, {
        projectId: input.projectId,
        baseRevision: input.baseRevision,
        transactionId: input.transactionId,
        schemaVersion: input.schemaVersion,
        document,
      });
    },
  };

  return service;
}
