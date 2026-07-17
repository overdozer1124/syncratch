import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "./0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "./0003-r1-school-roster.js";
import {r1AccessImportAuditMigration} from "./0004-r1-access-import-audit.js";
import {configureSqliteConnection} from "./configure.js";
import {runSchemaMigrationsWithOptions} from "./runner.js";
import {captureSchemaFingerprint} from "./schema-fingerprint.js";
import targetFingerprint from "./r1-target-schema-fingerprint.json" with {
  type: "json",
};

const migrationsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(migrationsDir, "../..");
const repoRoot = join(packageRoot, "../..");
const baselineRelativePath =
  "packages/project-store-sqlite/src/migrations/r1-baseline-fingerprints.json";
const baselinePath = join(repoRoot, baselineRelativePath);

const dbs: Database.Database[] = [];
const tempDirs: string[] = [];

const targetMigrations = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
] as const;

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, {recursive: true, force: true});
  }
});

function openTempDb(): Database.Database {
  const tempDir = mkdtempSync(join(tmpdir(), "blocksync-target-fp-"));
  tempDirs.push(tempDir);
  const db = new Database(join(tempDir, "store.sqlite"));
  dbs.push(db);
  configureSqliteConnection(db);
  return db;
}

function applyV1ThroughV4(db: Database.Database): void {
  runSchemaMigrationsWithOptions(db, {
    migrations: targetMigrations,
    now: () => "2026-07-17T00:00:00.000Z",
  });
}

describe("final v4 target schema fingerprint", () => {
  it("matches committed final fingerprint after applying v1-v4 on a temp db", () => {
    const db = openTempDb();
    applyV1ThroughV4(db);

    const fingerprint = captureSchemaFingerprint(db);
    const tableNames = fingerprint.tables.map(table => table.name);

    expect(tableNames).toContain("workspaces");
    expect(tableNames).toContain("audit_events");
    expect(tableNames).toContain("organizations");
    expect(fingerprint).toEqual(targetFingerprint.current);
  });

  it("does not alter baseline adoption fingerprints file", () => {
    const headContents = execFileSync(
      "git",
      ["show", `HEAD:${baselineRelativePath}`],
      {cwd: repoRoot, encoding: "utf8"},
    );
    const workingContents = readFileSync(baselinePath, "utf8");
    const normalizeLineEndings = (contents: string) =>
      contents.replace(/\r\n/g, "\n");
    expect(normalizeLineEndings(workingContents)).toBe(
      normalizeLineEndings(headContents),
    );
  });
});
