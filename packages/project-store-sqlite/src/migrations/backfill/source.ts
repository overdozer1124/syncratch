import type Database from "better-sqlite3";

export interface LegacyOrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly created_at: string;
}

export interface LegacyUserRow {
  readonly id: string;
  readonly primary_organization_id: string;
  readonly display_name: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LegacyMembershipRow {
  readonly organization_id: string;
  readonly user_id: string;
  readonly role: string;
}

export interface LegacySessionRow {
  readonly id_hash: string;
  readonly user_id: string;
  readonly organization_id: string;
  readonly csrf_hash: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly last_seen_at: string | null;
}

export interface LegacyProjectRow {
  readonly id: string;
  readonly organization_id: string;
  readonly owner_user_id: string;
  readonly title: string;
  readonly head_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LegacyProjectMemberRow {
  readonly project_id: string;
  readonly user_id: string;
  readonly role: string;
}

export const LEGACY_BACKFILL_TARGET_TABLES = [
  "workspaces",
  "user_accounts",
  "people",
  "person_account_links",
  "workspace_memberships",
  "workspace_directory_revisions",
  "role_assignments",
] as const;

export type LegacyBackfillTargetTable =
  (typeof LEGACY_BACKFILL_TARGET_TABLES)[number];

export interface LegacyBackfillSource {
  readonly organizations: readonly LegacyOrganizationRow[];
  readonly users: readonly LegacyUserRow[];
  readonly memberships: readonly LegacyMembershipRow[];
  readonly sessions: readonly LegacySessionRow[];
  readonly projects: readonly LegacyProjectRow[];
  readonly projectMembers: readonly LegacyProjectMemberRow[];
  readonly targetRowCounts: Readonly<Record<LegacyBackfillTargetTable, number>>;
}

function readRows<Row>(
  db: Database.Database,
  sql: string,
): readonly Row[] {
  return db.prepare<[], Row>(sql).all();
}

export function readLegacyBackfillSource(
  db: Database.Database,
): LegacyBackfillSource {
  const organizations = readRows<LegacyOrganizationRow>(
    db,
    `SELECT id, name, status, created_at
       FROM organizations
      ORDER BY id`,
  );
  const users = readRows<LegacyUserRow>(
    db,
    `SELECT id, primary_organization_id, display_name, email, status,
            created_at, updated_at
       FROM users
      ORDER BY id`,
  );
  const memberships = readRows<LegacyMembershipRow>(
    db,
    `SELECT organization_id, user_id, role
       FROM organization_memberships
      ORDER BY organization_id, user_id`,
  );
  const sessions = readRows<LegacySessionRow>(
    db,
    `SELECT id_hash, user_id, organization_id, csrf_hash, created_at,
            expires_at, revoked_at, last_seen_at
       FROM sessions
      ORDER BY id_hash`,
  );
  const projects = readRows<LegacyProjectRow>(
    db,
    `SELECT id, organization_id, owner_user_id, title, head_revision,
            created_at, updated_at
       FROM projects
      ORDER BY id`,
  );
  const projectMembers = readRows<LegacyProjectMemberRow>(
    db,
    `SELECT project_id, user_id, role
       FROM project_members
      ORDER BY project_id, user_id`,
  );
  const targetRowCounts = Object.fromEntries(
    LEGACY_BACKFILL_TARGET_TABLES.map(table => [
      table,
      db
        .prepare<[], {readonly row_count: number}>(
          `SELECT COUNT(*) AS row_count FROM "${table}"`,
        )
        .get()!.row_count,
    ]),
  ) as Record<LegacyBackfillTargetTable, number>;

  return {
    organizations,
    users,
    memberships,
    sessions,
    projects,
    projectMembers,
    targetRowCounts,
  };
}
