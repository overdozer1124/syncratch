import {spawn} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
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
import {runSchemaMigrations} from "./index.js";
import targetFingerprint from "./r1-target-schema-fingerprint.json" with {
  type: "json",
};
import {captureSchemaFingerprint} from "./schema-fingerprint.js";
import {SchemaMigrationError} from "./types.js";

const dbs: Database.Database[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, {recursive: true, force: true});
  }
});

function createTempDbPath(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "blocksync-concurrency-"));
  tempDirs.push(tempDir);
  return join(tempDir, "store.sqlite");
}

function userTables(db: Database.Database): string[] {
  return db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .pluck()
    .all() as string[];
}

function spawnRaceChild(dbPath: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const childPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "migration-race-child.ts",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", childPath, dbPath],
      {stdio: ["ignore", "pipe", "pipe"]},
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", code => {
      resolve({code, stdout, stderr});
    });
  });
}

describe("concurrent migration startup", () => {
  it("maps lock contention to SCHEMA_BUSY without creating tables", () => {
    const dbPath = createTempDbPath();
    const owner = new Database(dbPath);
    const contender = new Database(dbPath);
    dbs.push(owner, contender);

    configureSqliteConnection(owner);
    configureSqliteConnection(contender, {busyTimeoutMs: 25});
    owner.exec("BEGIN IMMEDIATE");
    try {
      let thrown: unknown;
      try {
        runSchemaMigrations(contender);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SchemaMigrationError);
      expect(thrown).toMatchObject({
        name: "SchemaMigrationError",
        code: "SCHEMA_BUSY",
      });
      expect(userTables(contender)).toEqual([]);
      expect(contender.pragma("user_version", {simple: true})).toBe(0);
    } finally {
      owner.exec("ROLLBACK");
      owner.close();
      contender.close();
      dbs.splice(0, dbs.length);
    }
  });

  it("serializes two processes into one complete v1-v4 ledger", async () => {
    const dbPath = createTempDbPath();

    const [first, second] = await Promise.all([
      spawnRaceChild(dbPath),
      spawnRaceChild(dbPath),
    ]);

    for (const result of [first, second]) {
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(JSON.stringify({ok: true}));
      expect(result.stderr).toBe("");
    }

    const db = new Database(dbPath, {readonly: true});
    dbs.push(db);
    try {
      expect(
        db
          .prepare(
            `SELECT version, name, checksum FROM schema_migrations ORDER BY version`,
          )
          .all(),
      ).toEqual([
        {
          version: 1,
          name: "r1-baseline",
          checksum: r1BaselineMigration.checksum,
        },
        {
          version: 2,
          name: "r1-identity-core",
          checksum: r1IdentityCoreMigration.checksum,
        },
        {
          version: 3,
          name: "r1-school-roster",
          checksum: r1SchoolRosterMigration.checksum,
        },
        {
          version: 4,
          name: "r1-access-import-audit",
          checksum: r1AccessImportAuditMigration.checksum,
        },
      ]);
      expect(db.pragma("user_version", {simple: true})).toBe(4);
      expect(captureSchemaFingerprint(db)).toEqual(
        targetFingerprint.current,
      );
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(userTables(db)).toContain("workspaces");
      expect(userTables(db)).toContain("people");
    } finally {
      db.close();
      dbs.splice(0, dbs.length);
    }
  });
});
