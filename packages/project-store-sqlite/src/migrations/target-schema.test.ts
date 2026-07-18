import {mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, extname, join} from "node:path";
import {fileURLToPath} from "node:url";
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
import {computeLegacyBackfillPlan} from "./backfill/plan.js";
import {readLegacyBackfillSource} from "./backfill/source.js";
import {configureSqliteConnection} from "./configure.js";
import {runSchemaMigrations} from "./index.js";
import targetFingerprint from "./r1-target-schema-fingerprint.json" with {
  type: "json",
};
import {
  type MigrationFaultPoint,
  runSchemaMigrationsWithOptions,
} from "./runner.js";
import {captureSchemaFingerprint} from "./schema-fingerprint.js";

const migrationsDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(migrationsDir, "..");
const dbs: Database.Database[] = [];
const tempDirs: string[] = [];

const targetMigrations = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
] as const;

const backfilledTableNames = [
  "workspaces",
  "user_accounts",
  "people",
  "person_account_links",
  "workspace_memberships",
  "workspace_directory_revisions",
  "role_assignments",
] as const;

const nonBackfilledTargetTableNames = [
  "schools",
  "academic_years",
  "grades",
  "class_groups",
  "enrollments",
  "staff_assignments",
  "roster_imports",
  "roster_import_rows",
  "audit_events",
] as const;

const targetTableNames = [
  ...backfilledTableNames,
  ...nonBackfilledTargetTableNames,
] as const;

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, {recursive: true, force: true});
  }
});

function openMemory(): Database.Database {
  const db = new Database(":memory:");
  dbs.push(db);
  configureSqliteConnection(db);
  return db;
}

function createTempDir(prefix: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function ledgerVersions(db: Database.Database): number[] {
  return db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .pluck()
    .all() as number[];
}

function expectProductionEndState(db: Database.Database): void {
  expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5]);
  expect(db.pragma("user_version", {simple: true})).toBe(5);
  expect(captureSchemaFingerprint(db)).toEqual(targetFingerprint.current);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}

function expectV1ThroughV4EndState(db: Database.Database): void {
  expect(ledgerVersions(db)).toEqual([1, 2, 3, 4]);
  expect(db.pragma("user_version", {simple: true})).toBe(4);
  expect(captureSchemaFingerprint(db)).toEqual(targetFingerprint.current);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}

function tableRowCount(db: Database.Database, tableName: string): number {
  return db.prepare(`SELECT COUNT(*) FROM "${tableName}"`).pluck().get() as number;
}

function expectTargetTablesEmpty(db: Database.Database): void {
  for (const tableName of targetTableNames) {
    expect(tableRowCount(db, tableName), tableName).toBe(0);
  }
}

function expectNonBackfilledTablesEmpty(db: Database.Database): void {
  for (const tableName of nonBackfilledTargetTableNames) {
    expect(tableRowCount(db, tableName), tableName).toBe(0);
  }
}

function sortById<Row extends {id: string}>(rows: readonly Row[]): Row[] {
  return [...rows].sort((left, right) =>
    Buffer.compare(Buffer.from(left.id, "utf8"), Buffer.from(right.id, "utf8")),
  );
}

function computeExpectedPlan(
  appliedAt: string,
): ReturnType<typeof computeLegacyBackfillPlan> {
  const planCopy = copyLegacyR1Fixture(createTempDir("blocksync-target-plan-"));
  const planDb = new Database(planCopy.dbPath);
  dbs.push(planDb);
  configureSqliteConnection(planDb);
  runSchemaMigrationsWithOptions(planDb, {
    migrations: targetMigrations,
    now: () => appliedAt,
  });
  const source = readLegacyBackfillSource(planDb);
  return computeLegacyBackfillPlan(source, {appliedAt});
}

function readBackfilledSnapshot(
  db: Database.Database,
): Record<string, unknown[]> {
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

function productionSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (path === migrationsDir) continue;
      files.push(...productionSourceFiles(path));
    } else if (extname(path) === ".ts" && !path.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("production target schema", () => {
  it("migrates a fresh database through v1-v5 to the committed empty target", () => {
    const db = openMemory();

    runSchemaMigrations(db);

    expectProductionEndState(db);
    expectTargetTablesEmpty(db);
  });

  it("adopts a copied legacy fixture and backfills the workspace/person schema", () => {
    const copied = copyLegacyR1Fixture(
      createTempDir("blocksync-target-legacy-"),
    );
    const before = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);

    const store = openSqliteStore({dbPath: copied.dbPath});
    store.close();

    const db = new Database(copied.dbPath, {readonly: true});
    dbs.push(db);
    expectProductionEndState(db);
    expectNonBackfilledTablesEmpty(db);

    const appliedAt = (
      db
        .prepare(`SELECT applied_at FROM schema_migrations WHERE version = 5`)
        .get() as {applied_at: string}
    ).applied_at;
    const plan = computeExpectedPlan(appliedAt);
    const snapshot = readBackfilledSnapshot(db);
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

    const after = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
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
  });

  it.each([
    [3, "after_apply_before_ledger"],
    [3, "after_ledger_before_user_version"],
    [4, "after_apply_before_ledger"],
    [4, "after_ledger_before_user_version"],
  ] as const)(
    "rolls back only v%i at %s and reaches the v1-v4 target on retry",
    (faultVersion: 3 | 4, faultPoint: MigrationFaultPoint) => {
      const db = openMemory();
      const marker = new Error(`fault:v${faultVersion}:${faultPoint}`);

      expect(() =>
        runSchemaMigrationsWithOptions(db, {
          migrations: targetMigrations,
          now: () => "2026-07-17T00:00:00.000Z",
          fault: (point, migration) => {
            if (migration.version === faultVersion && point === faultPoint) {
              throw marker;
            }
          },
        }),
      ).toThrow(marker);

      const priorVersions =
        faultVersion === 3 ? [1, 2] : [1, 2, 3];
      expect(ledgerVersions(db)).toEqual(priorVersions);
      expect(db.pragma("user_version", {simple: true})).toBe(
        faultVersion - 1,
      );

      runSchemaMigrationsWithOptions(db, {
        migrations: targetMigrations,
        now: () => "2026-07-17T00:00:00.000Z",
      });

      expectV1ThroughV4EndState(db);
      expectTargetTablesEmpty(db);
    },
  );

  it("keeps production consumers other than the directory adapter unread from target tables", () => {
    const forbiddenPattern = new RegExp(
      `\\b(${targetTableNames.join("|")})\\b`,
    );
    const matches = productionSourceFiles(sourceRoot)
      .filter(path => basename(path) !== "directory-repository.ts")
      .flatMap(path => {
        const lines = readFileSync(path, "utf8").split(/\r?\n/);
        return lines.flatMap((line, index) =>
          forbiddenPattern.test(line)
            ? [`${path}:${index + 1}:${line.trim()}`]
            : [],
        );
      });

    expect(matches).toEqual([]);
  });
});
