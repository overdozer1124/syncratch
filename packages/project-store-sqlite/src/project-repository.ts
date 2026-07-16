import type Database from "better-sqlite3";
import {
  assertEnvelope,
  type ProjectEnvelopeV1,
} from "@blocksync/project-envelope";
import {
  StaleRevisionError,
  type ProjectRepository,
  type ProjectRepositoryTx,
  type ProjectSummary,
  type SnapshotMeta,
} from "@blocksync/project-service";
import { withImmediateTransaction } from "./immediate-transaction.js";

function parseEnvelope(json: string): ProjectEnvelopeV1 {
  return assertEnvelope(JSON.parse(json));
}

export function createSqliteProjectRepository(
  db: Database.Database,
): ProjectRepository {
  const stmts = {
    insertProject: db.prepare(`
      INSERT INTO projects (id, organization_id, owner_user_id, title, head_revision, created_at, updated_at)
      VALUES (@id, @organizationId, @ownerUserId, @title, @headRevision, @createdAt, @updatedAt)
    `),
    insertMember: db.prepare(`
      INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
    `),
    insertRevision: db.prepare(`
      INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at, client_transaction_id
      ) VALUES (
        @projectId, @revision, @envelopeJson, @contentHash, @requestHash,
        @actorUserId, @createdAt, @transactionId
      )
    `),
    listForMember: db.prepare(`
      SELECT p.id AS projectId, p.title AS title, p.head_revision AS revision
      FROM projects p
      INNER JOIN project_members m ON m.project_id = p.id
      WHERE m.user_id = ? AND p.organization_id = ?
      ORDER BY p.id
    `),
    getMembership: db.prepare(`
      SELECT m.role AS role, p.organization_id AS organizationId
      FROM project_members m
      INNER JOIN projects p ON p.id = m.project_id
      WHERE m.project_id = ? AND m.user_id = ?
    `),
    getHead: db.prepare(`
      SELECT r.envelope_json AS envelopeJson
      FROM projects p
      INNER JOIN project_revisions r
        ON r.project_id = p.id AND r.revision = p.head_revision
      WHERE p.id = ?
    `),
    findByTx: db.prepare(`
      SELECT envelope_json AS envelopeJson, request_hash AS requestHash
      FROM project_revisions
      WHERE project_id = ? AND client_transaction_id = ?
    `),
    casHead: db.prepare(`
      UPDATE projects
      SET head_revision = @nextRevision, title = @title, updated_at = @updatedAt
      WHERE id = @projectId AND head_revision = @baseRevision
    `),
    insertSnapshot: db.prepare(`
      INSERT INTO project_snapshots (
        id, project_id, based_on_revision, reason, content_hash, storage_key, created_by, created_at
      ) VALUES (
        @snapshotId, @projectId, @basedOnRevision, @reason, @contentHash, @storageKey, @createdBy, @createdAt
      )
    `),
    getSnapshot: db.prepare(`
      SELECT
        id AS snapshotId,
        project_id AS projectId,
        based_on_revision AS basedOnRevision,
        reason AS reason,
        content_hash AS contentHash,
        storage_key AS storageKey,
        created_by AS createdBy,
        created_at AS createdAt
      FROM project_snapshots
      WHERE project_id = ? AND id = ?
    `),
    listSnapshots: db.prepare(`
      SELECT
        id AS snapshotId,
        project_id AS projectId,
        based_on_revision AS basedOnRevision,
        reason AS reason,
        content_hash AS contentHash,
        storage_key AS storageKey,
        created_by AS createdBy,
        created_at AS createdAt
      FROM project_snapshots
      WHERE project_id = ?
      ORDER BY id
    `),
    listAllStorageKeys: db.prepare(`
      SELECT DISTINCT storage_key AS storageKey FROM project_snapshots
    `),
  };

  const createTx = (): ProjectRepositoryTx => ({
    createProject(args) {
      const createdAt = args.envelope.updatedAt;
      stmts.insertProject.run({
        id: args.projectId,
        organizationId: args.organizationId,
        ownerUserId: args.ownerUserId,
        title: args.title,
        headRevision: args.envelope.revision,
        createdAt,
        updatedAt: createdAt,
      });
      stmts.insertMember.run(args.projectId, args.ownerUserId, "owner");
      stmts.insertRevision.run({
        projectId: args.projectId,
        revision: args.envelope.revision,
        envelopeJson: JSON.stringify(args.envelope),
        contentHash: args.envelope.contentHash,
        requestHash: "",
        actorUserId: args.ownerUserId,
        createdAt,
        transactionId: null,
      });
      return args.envelope;
    },

    listProjectSummariesForMember(userId, organizationId): ProjectSummary[] {
      return stmts.listForMember.all(userId, organizationId) as ProjectSummary[];
    },

    getMembership(projectId, userId) {
      const row = stmts.getMembership.get(projectId, userId) as
        | { role: "owner" | "member" | "admin"; organizationId: string }
        | undefined;
      return row ?? null;
    },

    getHead(projectId) {
      const row = stmts.getHead.get(projectId) as
        | { envelopeJson: string }
        | undefined;
      return row ? parseEnvelope(row.envelopeJson) : null;
    },

    findRevisionByTransactionId(projectId, transactionId) {
      const row = stmts.findByTx.get(projectId, transactionId) as
        | { envelopeJson: string; requestHash: string }
        | undefined;
      if (!row) return null;
      return {
        envelope: parseEnvelope(row.envelopeJson),
        requestHash: row.requestHash,
      };
    },

    commitRevision(args) {
      const info = stmts.casHead.run({
        projectId: args.projectId,
        baseRevision: args.baseRevision,
        nextRevision: args.envelope.revision,
        title: args.envelope.title,
        updatedAt: args.envelope.updatedAt,
      });
      if (info.changes !== 1) {
        throw new StaleRevisionError();
      }
      stmts.insertRevision.run({
        projectId: args.projectId,
        revision: args.envelope.revision,
        envelopeJson: JSON.stringify(args.envelope),
        contentHash: args.contentHash,
        requestHash: args.requestHash,
        actorUserId: args.envelope.updatedByUserId,
        createdAt: args.envelope.updatedAt,
        transactionId: args.transactionId,
      });
      return args.envelope;
    },

    insertSnapshotMeta(meta) {
      stmts.insertSnapshot.run(meta);
    },

    getSnapshotMeta(projectId, snapshotId) {
      const row = stmts.getSnapshot.get(projectId, snapshotId) as
        | SnapshotMeta
        | undefined;
      return row ?? null;
    },

    listSnapshotMeta(projectId) {
      return stmts.listSnapshots.all(projectId) as SnapshotMeta[];
    },

    listAllSnapshotStorageKeys() {
      const rows = stmts.listAllStorageKeys.all() as Array<{ storageKey: string }>;
      return rows.map((r) => r.storageKey);
    },
  });

  const txApi = createTx();

  return {
    listAllSnapshotStorageKeys() {
      return txApi.listAllSnapshotStorageKeys();
    },
    withTransaction<T>(fn: (tx: ProjectRepositoryTx) => T): T {
      return withImmediateTransaction(db, () => fn(txApi));
    },
  };
}
