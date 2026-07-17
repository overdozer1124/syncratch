import {createHash} from "node:crypto";
import {cpSync, mkdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
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
  organizationDomains: Array<{organizationId: string; hostedDomain: string}>;
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
  projectMembers: Array<{projectId: string; userId: string; role: string}>;
  revisions: Array<{
    projectId: string;
    revision: number;
    envelopeJson: string;
    contentHash: string;
    requestHash: string;
    clientTransactionId: string | null;
    actorUserId: string;
    createdAt: string;
  }>;
  snapshots: Array<{
    projectId: string;
    snapshotId: string;
    basedOnRevision: number;
    reason: string;
    contentHash: string;
    storageKey: string;
    createdBy: string;
    createdAt: string;
  }>;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function copyLegacyR1Fixture(destinationRoot: string): {
  dbPath: string;
  snapshotDir: string;
  manifest: LegacyR1Manifest;
} {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const sourceDbPath = join(fixtureDir, "legacy-r1.sqlite");
  const sourceSnapshotDir = join(fixtureDir, "legacy-r1-snapshots");
  const sourceManifestPath = join(fixtureDir, "legacy-r1.manifest.json");

  mkdirSync(destinationRoot, {recursive: true});
  const dbPath = join(destinationRoot, "projects.sqlite");
  const snapshotDir = join(destinationRoot, "snapshots");

  cpSync(sourceDbPath, dbPath);
  cpSync(sourceSnapshotDir, snapshotDir, {recursive: true});

  const manifest = JSON.parse(
    readFileSync(sourceManifestPath, "utf8"),
  ) as LegacyR1Manifest;

  return {dbPath, snapshotDir, manifest};
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

    const organizationDomains = (
      db
        .prepare(
          `SELECT organization_id, hosted_domain
           FROM organization_domains
           ORDER BY organization_id, hosted_domain`,
        )
        .all() as Array<{
        organization_id: string;
        hosted_domain: string;
      }>
    ).map(row => ({
      organizationId: row.organization_id,
      hostedDomain: row.hosted_domain,
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

    const projectMembers = (
      db
        .prepare(
          `SELECT project_id, user_id, role
           FROM project_members
           ORDER BY project_id, user_id`,
        )
        .all() as Array<{
        project_id: string;
        user_id: string;
        role: string;
      }>
    ).map(row => ({
      projectId: row.project_id,
      userId: row.user_id,
      role: row.role,
    }));

    const revisions = (
      db
        .prepare(
          `SELECT project_id, revision, envelope_json, content_hash, request_hash,
                  client_transaction_id, actor_user_id, created_at
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
        actor_user_id: string;
        created_at: string;
      }>
    ).map(row => ({
      projectId: row.project_id,
      revision: row.revision,
      envelopeJson: row.envelope_json,
      contentHash: row.content_hash,
      requestHash: row.request_hash,
      clientTransactionId: row.client_transaction_id,
      actorUserId: row.actor_user_id,
      createdAt: row.created_at,
    }));

    const snapshots = (
      db
        .prepare(
          `SELECT project_id, id, based_on_revision, reason, content_hash,
                  storage_key, created_by, created_at
           FROM project_snapshots
           ORDER BY project_id, id`,
        )
        .all() as Array<{
        project_id: string;
        id: string;
        based_on_revision: number;
        reason: string;
        content_hash: string;
        storage_key: string;
        created_by: string;
        created_at: string;
      }>
    ).map(row => ({
      projectId: row.project_id,
      snapshotId: row.id,
      basedOnRevision: row.based_on_revision,
      reason: row.reason,
      contentHash: row.content_hash,
      storageKey: row.storage_key,
      createdBy: row.created_by,
      createdAt: row.created_at,
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
      organizationDomains,
      memberships,
      sessions,
      projects,
      projectMembers,
      revisions,
      snapshots,
    };
  } finally {
    db.close();
  }
}
