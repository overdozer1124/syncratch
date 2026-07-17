import {existsSync, mkdtempSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {
  copyLegacyR1Fixture,
  readLegacyR1Manifest,
} from "../fixtures/legacy-r1-manifest.js";
import {openSqliteStore} from "../store.js";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "./0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "./0003-r1-school-roster.js";
import {r1AccessImportAuditMigration} from "./0004-r1-access-import-audit.js";
import {r1LegacyOrganizationUserBackfillMigration} from "./0005-r1-legacy-organization-user-backfill.js";
import {computeLegacyBackfillPlan} from "./backfill/plan.js";
import {
  LEGACY_BACKFILL_TARGET_TABLES,
  readLegacyBackfillSource,
} from "./backfill/source.js";
import {configureSqliteConnection} from "./configure.js";
import {runSchemaMigrations} from "./index.js";
import targetFingerprint from "./r1-target-schema-fingerprint.json" with {
  type: "json",
};
import {runSchemaMigrationsWithOptions} from "./runner.js";
import {captureSchemaFingerprint} from "./schema-fingerprint.js";
import {SchemaMigrationError} from "./types.js";

const APPLIED_AT = "2026-07-18T00:00:00.000Z";

const v1ThroughV4 = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
] as const;

const dbs: Database.Database[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) {
    if (db.open) db.close();
  }
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, {recursive: true, force: true});
  }
});

function createTempDir(prefix = "blocksync-v5-integration-"): string {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function openTracked(path: string): Database.Database {
  const db = new Database(path);
  dbs.push(db);
  configureSqliteConnection(db);
  return db;
}

function backupNames(directory: string): string[] {
  return readdirSync(directory).filter(name => name.includes(".pre-v5."));
}

function ledgerVersions(db: Database.Database): number[] {
  return db
    .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
    .pluck()
    .all() as number[];
}

function targetCounts(db: Database.Database): Record<string, number> {
  return Object.fromEntries(
    LEGACY_BACKFILL_TARGET_TABLES.map(table => [
      table,
      (
        db
          .prepare(`SELECT COUNT(*) AS row_count FROM "${table}"`)
          .get() as {row_count: number}
      ).row_count,
    ]),
  );
}

function v5AppliedAt(db: Database.Database): string {
  return (
    db
      .prepare(
        `SELECT applied_at FROM schema_migrations WHERE version = 5`,
      )
      .get() as {applied_at: string}
  ).applied_at;
}

function readTargetSnapshot(db: Database.Database): Record<string, unknown[]> {
  return {
    workspaces: db
      .prepare(
        `SELECT id, kind, name, created_at, updated_at
         FROM workspaces ORDER BY id`,
      )
      .all(),
    user_accounts: db
      .prepare(
        `SELECT id, display_name, email, status, created_at, updated_at
         FROM user_accounts ORDER BY id`,
      )
      .all(),
    people: db
      .prepare(
        `SELECT id, display_name, status, created_at, updated_at
         FROM people ORDER BY id`,
      )
      .all(),
    person_account_links: db
      .prepare(
        `SELECT id, person_id, account_id, status, linked_at, unlinked_at
         FROM person_account_links ORDER BY id`,
      )
      .all(),
    workspace_memberships: db
      .prepare(
        `SELECT id, workspace_id, account_id, role, status, started_at, ended_at
         FROM workspace_memberships ORDER BY id`,
      )
      .all(),
    workspace_directory_revisions: db
      .prepare(
        `SELECT workspace_id, revision, updated_at
         FROM workspace_directory_revisions ORDER BY workspace_id`,
      )
      .all(),
    role_assignments: db
      .prepare(
        `SELECT id, account_id, scope_kind, workspace_id, school_id,
                class_group_id, project_id, role, status, started_at, ended_at
         FROM role_assignments ORDER BY id`,
      )
      .all(),
  };
}

function sortById<Row extends {id: string}>(rows: readonly Row[]): Row[] {
  return [...rows].sort((left, right) =>
    Buffer.compare(Buffer.from(left.id, "utf8"), Buffer.from(right.id, "utf8")),
  );
}

function computeExpectedPlan(
  appliedAt: string,
): ReturnType<typeof computeLegacyBackfillPlan> {
  const planCopy = copyLegacyR1Fixture(createTempDir("blocksync-v5-plan-"));
  const planDb = openTracked(planCopy.dbPath);
  runSchemaMigrationsWithOptions(planDb, {
    migrations: v1ThroughV4,
    now: () => appliedAt,
  });
  const source = readLegacyBackfillSource(planDb);
  return computeLegacyBackfillPlan(source, {appliedAt});
}

describe("legacy backfill production integration", () => {
  it("advances a fresh file database to version 5 without a backup or target rows", () => {
    const tempDir = createTempDir();
    const dbPath = join(tempDir, "fresh.sqlite");
    const db = openTracked(dbPath);

    runSchemaMigrations(db);

    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5]);
    expect(db.pragma("user_version", {simple: true})).toBe(5);
    expect(backupNames(tempDir)).toEqual([]);
    expect(targetCounts(db)).toEqual({
      workspaces: 0,
      user_accounts: 0,
      people: 0,
      person_account_links: 0,
      workspace_memberships: 0,
      workspace_directory_revisions: 0,
      role_assignments: 0,
    });
    expect(captureSchemaFingerprint(db)).toEqual(targetFingerprint.current);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("backfills a copied accepted fixture through the production store boundary", () => {
    const tempDir = createTempDir();
    const copied = copyLegacyR1Fixture(tempDir);

    const store = openSqliteStore({dbPath: copied.dbPath});
    store.close();

    const db = new Database(copied.dbPath, {readonly: true});
    dbs.push(db);

    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5]);
    expect(db.pragma("user_version", {simple: true})).toBe(5);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const appliedAt = v5AppliedAt(db);
    const plan = computeExpectedPlan(appliedAt);

    const snapshot = readTargetSnapshot(db);
    expect(snapshot.workspaces).toEqual([...plan.workspaces]);
    expect(snapshot.user_accounts).toEqual([...plan.userAccounts]);
    expect(snapshot.people).toEqual([...plan.people]);
    expect(snapshot.person_account_links).toEqual([...plan.personAccountLinks]);
    expect(snapshot.workspace_memberships).toEqual([
      ...plan.workspaceMemberships,
    ]);
    expect(snapshot.workspace_directory_revisions).toEqual([
      ...plan.workspaceDirectoryRevisions,
    ]);
    expect(snapshot.role_assignments).toEqual(sortById(plan.roleAssignments));

    const sessions = db
      .prepare(`SELECT id_hash, revoked_at FROM sessions ORDER BY id_hash`)
      .all() as Array<{id_hash: string; revoked_at: string | null}>;
    for (const idHash of plan.sessionIdsToRevoke) {
      expect(sessions.find(row => row.id_hash === idHash)?.revoked_at).toBe(
        appliedAt,
      );
    }

    expect(backupNames(tempDir)).toHaveLength(1);
    expect(existsSync(join(tempDir, backupNames(tempDir)[0]!))).toBe(true);
  });

  it("changes only null session revocations in the frozen legacy evidence", () => {
    const tempDir = createTempDir();
    const copied = copyLegacyR1Fixture(tempDir);
    const before = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);

    const store = openSqliteStore({dbPath: copied.dbPath});
    store.close();

    const after = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
    const appliedAt = (() => {
      const db = new Database(copied.dbPath, {readonly: true});
      try {
        return v5AppliedAt(db);
      } finally {
        db.close();
      }
    })();

    const {
      databaseSha256: _beforeSha,
      sessions: beforeSessions,
      ...beforeEvidence
    } = before;
    const {
      databaseSha256: _afterSha,
      sessions: afterSessions,
      ...afterEvidence
    } = after;

    expect(afterEvidence).toEqual(beforeEvidence);
    expect(afterSessions).toEqual(
      beforeSessions.map(session => ({
        ...session,
        revokedAt: session.revokedAt ?? appliedAt,
      })),
    );
    for (const session of afterSessions) {
      expect(session.revokedAt).not.toBeNull();
    }
  });

  it("aborts under the write lock when a legacy row changes after preparation", () => {
    const tempDir = createTempDir();
    const copied = copyLegacyR1Fixture(tempDir);
    const db = openTracked(copied.dbPath);

    const racingMigration = {
      ...r1LegacyOrganizationUserBackfillMigration,
      prepare(migrationDb: Database.Database, context: {appliedAt: string}) {
        const preparation =
          r1LegacyOrganizationUserBackfillMigration.prepare!(
            migrationDb,
            context,
          );
        const first = migrationDb
          .prepare(`SELECT id FROM organizations ORDER BY id LIMIT 1`)
          .get() as {id: string};
        migrationDb
          .prepare(`UPDATE organizations SET name = ? WHERE id = ?`)
          .run("mutated-after-prepare", first.id);
        return preparation;
      },
    };

    let thrown: unknown;
    try {
      runSchemaMigrationsWithOptions(db, {
        migrations: [
          r1BaselineMigration,
          r1IdentityCoreMigration,
          r1SchoolRosterMigration,
          r1AccessImportAuditMigration,
          racingMigration,
        ],
        now: () => APPLIED_AT,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SchemaMigrationError);
    expect((thrown as SchemaMigrationError).code).toBe(
      "SCHEMA_BACKFILL_INVALID",
    );
    expect(db.pragma("user_version", {simple: true})).toBe(4);
    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4]);
    expect(targetCounts(db)).toEqual({
      workspaces: 0,
      user_accounts: 0,
      people: 0,
      person_account_links: 0,
      workspace_memberships: 0,
      workspace_directory_revisions: 0,
      role_assignments: 0,
    });
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS row_count FROM sessions WHERE revoked_at IS NULL`,
          )
          .get() as {row_count: number}
      ).row_count,
    ).toBeGreaterThan(0);
    expect(backupNames(tempDir).length).toBeGreaterThanOrEqual(1);
    for (const name of backupNames(tempDir)) {
      expect(existsSync(join(tempDir, name))).toBe(true);
    }
  });
});
