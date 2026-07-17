import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import Database from "better-sqlite3";

export interface LegacyR1Manifest {
  format: "blocksync.legacy-r1-fixture/v1";
  generatedAt: "2026-07-17T00:00:00.000Z";
  databaseSha256: string;
  snapshotSha256: Record<string, string>;
  organizations: Array<{id: string; name: string; status: string}>;
  users: Array<{id: string; primaryOrganizationId: string; status: string}>;
  externalIdentities: Array<{
    provider: string;
    subject: string;
    userId: string;
    organizationId: string;
  }>;
  memberships: Array<{organizationId: string; userId: string; role: string}>;
  sessions: Array<{
    idHash: string;
    userId: string;
    organizationId: string;
    revokedAt: string | null;
  }>;
  projects: Array<{
    id: string;
    organizationId: string;
    ownerUserId: string;
    headRevision: number;
  }>;
  revisions: Array<{
    projectId: string;
    revision: number;
    envelopeJson: string;
    contentHash: string;
    requestHash: string;
    clientTransactionId: string | null;
  }>;
  snapshots: Array<{
    projectId: string;
    snapshotId: string;
    contentHash: string;
    storageKey: string;
  }>;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readLegacyR1Manifest(
  dbPath: string,
  snapshotDir: string,
): LegacyR1Manifest {
  const db = new Database(dbPath, {readonly: true});
  try {
    const organizations = (
      db
        .prepare(
          `SELECT id, name, status FROM organizations ORDER BY id`,
        )
        .all() as Array<{id: string; name: string; status: string}>
    ).map(row => ({
      id: row.id,
      name: row.name,
      status: row.status,
    }));

    const users = (
      db
        .prepare(
          `SELECT id, primary_organization_id, status FROM users ORDER BY id`,
        )
        .all() as Array<{
        id: string;
        primary_organization_id: string;
        status: string;
      }>
    ).map(row => ({
      id: row.id,
      primaryOrganizationId: row.primary_organization_id,
      status: row.status,
    }));

    const externalIdentities = (
      db
        .prepare(
          `SELECT provider, subject, user_id, organization_id
           FROM external_identities
           ORDER BY provider, subject`,
        )
        .all() as Array<{
        provider: string;
        subject: string;
        user_id: string;
        organization_id: string;
      }>
    ).map(row => ({
      provider: row.provider,
      subject: row.subject,
      userId: row.user_id,
      organizationId: row.organization_id,
    }));

    const memberships = (
      db
        .prepare(
          `SELECT organization_id, user_id, role
           FROM organization_memberships
           ORDER BY organization_id, user_id`,
        )
        .all() as Array<{
        organization_id: string;
        user_id: string;
        role: string;
      }>
    ).map(row => ({
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role,
    }));

    const sessions = (
      db
        .prepare(
          `SELECT id_hash, user_id, organization_id, revoked_at
           FROM sessions
           ORDER BY id_hash`,
        )
        .all() as Array<{
        id_hash: string;
        user_id: string;
        organization_id: string;
        revoked_at: string | null;
      }>
    ).map(row => ({
      idHash: row.id_hash,
      userId: row.user_id,
      organizationId: row.organization_id,
      revokedAt: row.revoked_at,
    }));

    const projects = (
      db
        .prepare(
          `SELECT id, organization_id, owner_user_id, head_revision
           FROM projects
           ORDER BY id`,
        )
        .all() as Array<{
        id: string;
        organization_id: string;
        owner_user_id: string;
        head_revision: number;
      }>
    ).map(row => ({
      id: row.id,
      organizationId: row.organization_id,
      ownerUserId: row.owner_user_id,
      headRevision: row.head_revision,
    }));

    const revisions = (
      db
        .prepare(
          `SELECT project_id, revision, envelope_json, content_hash, request_hash,
                  client_transaction_id
           FROM project_revisions
           ORDER BY project_id, revision`,
        )
        .all() as Array<{
        project_id: string;
        revision: number;
        envelope_json: string;
        content_hash: string;
        request_hash: string;
        client_transaction_id: string | null;
      }>
    ).map(row => ({
      projectId: row.project_id,
      revision: row.revision,
      envelopeJson: row.envelope_json,
      contentHash: row.content_hash,
      requestHash: row.request_hash,
      clientTransactionId: row.client_transaction_id,
    }));

    const snapshots = (
      db
        .prepare(
          `SELECT project_id, id, content_hash, storage_key
           FROM project_snapshots
           ORDER BY project_id, id`,
        )
        .all() as Array<{
        project_id: string;
        id: string;
        content_hash: string;
        storage_key: string;
      }>
    ).map(row => ({
      projectId: row.project_id,
      snapshotId: row.id,
      contentHash: row.content_hash,
      storageKey: row.storage_key,
    }));

    const snapshotSha256: Record<string, string> = {};
    for (const snapshot of snapshots) {
      snapshotSha256[snapshot.storageKey] = sha256File(
        join(snapshotDir, snapshot.storageKey),
      );
    }

    return {
      format: "blocksync.legacy-r1-fixture/v1",
      generatedAt: "2026-07-17T00:00:00.000Z",
      databaseSha256: sha256File(dbPath),
      snapshotSha256,
      organizations,
      users,
      externalIdentities,
      memberships,
      sessions,
      projects,
      revisions,
      snapshots,
    };
  } finally {
    db.close();
  }
}
