import {mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, extname, join} from "node:path";
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

const targetTableNames = [
  "workspaces",
  "user_accounts",
  "people",
  "person_account_links",
  "workspace_memberships",
  "workspace_directory_revisions",
  "schools",
  "academic_years",
  "grades",
  "class_groups",
  "enrollments",
  "staff_assignments",
  "role_assignments",
  "roster_imports",
  "roster_import_rows",
  "audit_events",
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

function expectTargetEndState(db: Database.Database): void {
  expect(ledgerVersions(db)).toEqual([1, 2, 3, 4]);
  expect(db.pragma("user_version", {simple: true})).toBe(4);
  expect(captureSchemaFingerprint(db)).toEqual(targetFingerprint.current);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}

function expectTargetTablesEmpty(db: Database.Database): void {
  for (const tableName of targetTableNames) {
    const rowCount = db
      .prepare(`SELECT COUNT(*) FROM "${tableName}"`)
      .pluck()
      .get();
    expect(rowCount, tableName).toBe(0);
  }
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
  it("migrates a fresh database through v1-v4 to the committed empty target", () => {
    const db = openMemory();

    runSchemaMigrations(db);

    expectTargetEndState(db);
    expectTargetTablesEmpty(db);
  });

  it("adopts a copied legacy fixture and advances it without changing logical evidence", () => {
    const copied = copyLegacyR1Fixture(
      createTempDir("blocksync-target-legacy-"),
    );
    const before = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);

    const store = openSqliteStore({dbPath: copied.dbPath});
    store.close();

    const db = new Database(copied.dbPath, {readonly: true});
    dbs.push(db);
    expectTargetEndState(db);
    expectTargetTablesEmpty(db);

    const after = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
    const {databaseSha256: _beforeSha, ...beforeEvidence} = before;
    const {databaseSha256: _afterSha, ...afterEvidence} = after;
    expect(afterEvidence).toEqual(beforeEvidence);
  });

  it.each([
    [3, "after_apply_before_ledger"],
    [3, "after_ledger_before_user_version"],
    [4, "after_apply_before_ledger"],
    [4, "after_ledger_before_user_version"],
  ] as const)(
    "rolls back only v%i at %s and reaches the target on retry",
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

      expectTargetEndState(db);
      expectTargetTablesEmpty(db);
    },
  );

  it("keeps production consumers unread from target tables before repository cutover", () => {
    const forbiddenPattern = new RegExp(
      `\\b(${targetTableNames.join("|")})\\b`,
    );
    const matches = productionSourceFiles(sourceRoot).flatMap(path => {
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
