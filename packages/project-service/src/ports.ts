import type { AuthPrincipal } from "@blocksync/auth-context";
import type { ProjectEnvelopeV1 } from "@blocksync/project-envelope";
import type { ProjectDocument } from "@blocksync/project-schema";

export type ProjectAction = "read" | "write" | "admin";

export interface ProjectSummary {
  projectId: string;
  title: string;
  revision: number;
}

export interface SnapshotMeta {
  snapshotId: string;
  projectId: string;
  basedOnRevision: number;
  reason: string;
  contentHash: string;
  storageKey: string;
  createdBy: string;
  createdAt: string;
}

export interface ProjectRepositoryTx {
  createProject(args: {
    projectId: string;
    organizationId: string;
    ownerUserId: string;
    title: string;
    envelope: ProjectEnvelopeV1;
  }): ProjectEnvelopeV1;

  listProjectSummariesForMember(
    userId: string,
    organizationId: string,
  ): ProjectSummary[];

  getMembership(
    projectId: string,
    userId: string,
  ): { role: "owner" | "member" | "admin"; organizationId: string } | null;

  getHead(projectId: string): ProjectEnvelopeV1 | null;

  findRevisionByTransactionId(
    projectId: string,
    transactionId: string,
  ): { envelope: ProjectEnvelopeV1; requestHash: string } | null;

  commitRevision(args: {
    projectId: string;
    baseRevision: number;
    transactionId: string;
    envelope: ProjectEnvelopeV1;
    contentHash: string;
    requestHash: string;
  }): ProjectEnvelopeV1;

  insertSnapshotMeta(meta: SnapshotMeta): void;

  getSnapshotMeta(projectId: string, snapshotId: string): SnapshotMeta | null;

  listSnapshotMeta(projectId: string): SnapshotMeta[];
}

export interface ProjectRepository {
  /** SYNC callback only — never return a Promise from fn. */
  withTransaction<T>(fn: (tx: ProjectRepositoryTx) => T): T;
}

export interface SnapshotStore {
  putAtomic(contentHash: string, bytes: Uint8Array): { storageKey: string };
  get(storageKey: string): Uint8Array | null;
  gcOrphans(referencedStorageKeys: Iterable<string>): number;
}

export interface SaveDocumentInput {
  projectId: string;
  baseRevision: number;
  transactionId: string;
  schemaVersion: number;
  document: ProjectDocument;
}

export interface CreateProjectInput {
  title: string;
  projectId?: string;
}

export interface CreateSnapshotInput {
  projectId: string;
  reason?: string;
}

export interface RestoreSnapshotInput {
  projectId: string;
  snapshotId: string;
  baseRevision: number;
  transactionId: string;
  schemaVersion: number;
}

export type AuthHints = { headers: Record<string, string | undefined> };

export interface ProjectAccessPolicy {
  assertCan(
    principal: AuthPrincipal,
    projectId: string,
    action: ProjectAction,
    tx: ProjectRepositoryTx,
  ): void;
}
