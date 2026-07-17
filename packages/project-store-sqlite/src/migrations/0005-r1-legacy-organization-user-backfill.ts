import type Database from "better-sqlite3";
import {
  type LegacyBackfillPreparation,
  prepareLegacyBackfillBackup,
} from "./backfill/backup.js";
import {captureLegacyDataDigest} from "./backfill/legacy-digest.js";
import {computeLegacyBackfillPlan} from "./backfill/plan.js";
import {readLegacyBackfillSource} from "./backfill/source.js";
import {
  r1LegacyOrganizationUserBackfillChecksum,
  r1LegacyOrganizationUserBackfillChecksumSource,
  r1LegacyOrganizationUserBackfillName,
} from "./backfill/v5-descriptor.js";
import {
  SchemaMigrationError,
  type MigrationContext,
  type SchemaMigration,
} from "./types.js";

export {
  r1LegacyOrganizationUserBackfillChecksumSource,
} from "./backfill/v5-descriptor.js";

function isPreparation(
  value: unknown,
): value is LegacyBackfillPreparation {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as {kind?: unknown}).kind;
  return kind === "empty" || kind === "verified" || kind === "already_applied";
}

function requireContext(
  context: MigrationContext | undefined,
): MigrationContext {
  if (context === undefined) {
    throw new SchemaMigrationError(
      "SCHEMA_BACKFILL_INVALID",
      "Legacy backfill apply requires a migration context",
    );
  }
  return context;
}

function assertEmptySource(db: Database.Database): void {
  const source = readLegacyBackfillSource(db);
  if (
    source.organizations.length > 0 ||
    source.users.length > 0 ||
    source.memberships.length > 0 ||
    source.sessions.length > 0 ||
    source.projects.length > 0 ||
    source.projectMembers.length > 0
  ) {
    throw new SchemaMigrationError(
      "SCHEMA_BACKFILL_INVALID",
      "Empty preparation requires an empty legacy source under the write lock",
    );
  }
}

function assertLockedDigest(
  db: Database.Database,
  expectedDigest: string,
): void {
  const liveDigest = captureLegacyDataDigest(db);
  if (liveDigest !== expectedDigest) {
    throw new SchemaMigrationError(
      "SCHEMA_BACKFILL_INVALID",
      "Live legacy digest does not match the verified backup digest",
    );
  }
}

function insertTargetRows(
  db: Database.Database,
  plan: ReturnType<typeof computeLegacyBackfillPlan>,
): void {
  const insertWorkspace = db.prepare(
    `INSERT INTO workspaces(id, kind, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of plan.workspaces) {
    insertWorkspace.run(
      row.id,
      row.kind,
      row.name,
      row.created_at,
      row.updated_at,
    );
  }

  const insertAccount = db.prepare(
    `INSERT INTO user_accounts(id, display_name, email, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of plan.userAccounts) {
    insertAccount.run(
      row.id,
      row.display_name,
      row.email,
      row.status,
      row.created_at,
      row.updated_at,
    );
  }

  const insertPerson = db.prepare(
    `INSERT INTO people(id, display_name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of plan.people) {
    insertPerson.run(
      row.id,
      row.display_name,
      row.status,
      row.created_at,
      row.updated_at,
    );
  }

  const insertLink = db.prepare(
    `INSERT INTO person_account_links(
       id, person_id, account_id, status, linked_at, unlinked_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of plan.personAccountLinks) {
    insertLink.run(
      row.id,
      row.person_id,
      row.account_id,
      row.status,
      row.linked_at,
      row.unlinked_at,
    );
  }

  const insertMembership = db.prepare(
    `INSERT INTO workspace_memberships(
       id, workspace_id, account_id, role, status, started_at, ended_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of plan.workspaceMemberships) {
    insertMembership.run(
      row.id,
      row.workspace_id,
      row.account_id,
      row.role,
      row.status,
      row.started_at,
      row.ended_at,
    );
  }

  const insertRevision = db.prepare(
    `INSERT INTO workspace_directory_revisions(workspace_id, revision, updated_at)
     VALUES (?, ?, ?)`,
  );
  for (const row of plan.workspaceDirectoryRevisions) {
    insertRevision.run(row.workspace_id, row.revision, row.updated_at);
  }

  const insertRole = db.prepare(
    `INSERT INTO role_assignments(
       id, account_id, scope_kind, workspace_id, school_id, class_group_id,
       project_id, role, status, started_at, ended_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of plan.roleAssignments) {
    insertRole.run(
      row.id,
      row.account_id,
      row.scope_kind,
      row.workspace_id,
      row.school_id,
      row.class_group_id,
      row.project_id,
      row.role,
      row.status,
      row.started_at,
      row.ended_at,
    );
  }
}

function revokeSessions(
  db: Database.Database,
  appliedAt: string,
  sessionIdsToRevoke: readonly string[],
): void {
  const revoke = db.prepare(
    `UPDATE sessions
        SET revoked_at = ?
      WHERE id_hash = ?
        AND revoked_at IS NULL`,
  );
  let updated = 0;
  for (const idHash of sessionIdsToRevoke) {
    const result = revoke.run(appliedAt, idHash);
    updated += result.changes;
  }
  if (updated !== sessionIdsToRevoke.length) {
    throw new SchemaMigrationError(
      "SCHEMA_BACKFILL_INVALID",
      `Expected to revoke ${sessionIdsToRevoke.length} sessions, updated ${updated}`,
    );
  }
}

function applyVerifiedBackfill(
  db: Database.Database,
  context: MigrationContext,
  preparation: Extract<LegacyBackfillPreparation, {kind: "verified"}>,
): void {
  assertLockedDigest(db, preparation.legacyDigest);

  const source = readLegacyBackfillSource(db);
  const plan = computeLegacyBackfillPlan(source, context);
  insertTargetRows(db, plan);
  revokeSessions(db, context.appliedAt, plan.sessionIdsToRevoke);
}

export const r1LegacyOrganizationUserBackfillMigration: SchemaMigration = {
  version: 5,
  name: r1LegacyOrganizationUserBackfillName,
  checksumSource: r1LegacyOrganizationUserBackfillChecksumSource,
  checksum: r1LegacyOrganizationUserBackfillChecksum,
  prepare(db, context) {
    return prepareLegacyBackfillBackup(db, context);
  },
  apply(db, context, preparation) {
    const appliedContext = requireContext(context);
    if (!isPreparation(preparation)) {
      throw new SchemaMigrationError(
        "SCHEMA_BACKFILL_INVALID",
        "Legacy backfill apply requires a preparation result",
      );
    }

    switch (preparation.kind) {
      case "empty":
        assertEmptySource(db);
        return;
      case "already_applied":
        throw new SchemaMigrationError(
          "SCHEMA_BACKFILL_INVALID",
          "already_applied preparation is invalid while version 5 is still pending",
        );
      case "verified":
        applyVerifiedBackfill(db, appliedContext, preparation);
        return;
    }
  },
};
