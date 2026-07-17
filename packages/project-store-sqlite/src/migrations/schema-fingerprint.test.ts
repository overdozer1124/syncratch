import {existsSync, mkdtempSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {copyLegacyR1Fixture} from "../fixtures/legacy-r1-manifest.js";
import baselineFingerprints from "./r1-baseline-fingerprints.json" with {
  type: "json",
};
import {
  captureSchemaFingerprint,
  classifyLedgerlessDatabase,
  fingerprintDifference,
  normalizeSql,
} from "./schema-fingerprint.js";

const dbs: Database.Database[] = [];
const tempDirs: string[] = [];
const sourceDbPath = fileURLToPath(
  new URL("../fixtures/legacy-r1.sqlite", import.meta.url),
);

function assertNoSourceSidecars(): void {
  const directory = dirname(sourceDbPath);
  const dbName = basename(sourceDbPath);
  const names = new Set(readdirSync(directory));
  expect(names.has(`${dbName}-wal`)).toBe(false);
  expect(names.has(`${dbName}-shm`)).toBe(false);
  expect(existsSync(`${sourceDbPath}-wal`)).toBe(false);
  expect(existsSync(`${sourceDbPath}-shm`)).toBe(false);
}

describe("schema fingerprint", () => {
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });

  it("normalizes whitespace outside quotes but preserves quoted contents", () => {
    expect(
      normalizeSql(
        `CREATE TABLE t (  id TEXT , label TEXT CHECK(label = 'a  b')  )`,
      ),
    ).toBe("CREATE TABLE t (id TEXT,label TEXT CHECK(label = 'a  b'))");
    expect(normalizeSql(`CREATE TABLE " odd  name "(id TEXT)`)).toBe(
      `CREATE TABLE " odd  name "(id TEXT)`,
    );
    expect(normalizeSql("CREATE TABLE [ odd  name ](id TEXT)")).toBe(
      "CREATE TABLE [ odd  name ](id TEXT)",
    );
    expect(normalizeSql("CREATE TABLE ` odd  name `(id TEXT)")).toBe(
      "CREATE TABLE ` odd  name `(id TEXT)",
    );
  });

  it("classifies an empty in-memory database as empty", () => {
    const db = new Database(":memory:");
    dbs.push(db);

    expect(classifyLedgerlessDatabase(db)).toEqual({kind: "empty"});
  });

  it("classifies a copied legacy R1 fixture as current", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "schema-fp-current-"));
    tempDirs.push(tempDir);

    const copied = copyLegacyR1Fixture(tempDir);
    const db = new Database(copied.dbPath);
    try {
      expect(classifyLedgerlessDatabase(db)).toEqual({kind: "current"});
    } finally {
      db.close();
    }

    assertNoSourceSidecars();
  });

  it("classifies a copied fixture without asset_gc_lock.generation as pre_generation", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "schema-fp-pregen-"));
    tempDirs.push(tempDir);

    const copied = copyLegacyR1Fixture(tempDir);
    const db = new Database(copied.dbPath);
    try {
      db.exec("ALTER TABLE asset_gc_lock DROP COLUMN generation");
      expect(classifyLedgerlessDatabase(db)).toEqual({kind: "pre_generation"});
    } finally {
      db.close();
    }

    assertNoSourceSidecars();
  });

  it("freezes current/preGeneration fingerprints that differ only on asset_gc_lock.generation", () => {
    expect(baselineFingerprints.format).toBe(
      "blocksync.r1-schema-fingerprints/v1",
    );
    const difference = fingerprintDifference(
      baselineFingerprints.current,
      baselineFingerprints.preGeneration,
    );
    expect(difference).not.toBeNull();
    expect(difference).toMatch(/asset_gc_lock|generation|columns/);

    const currentByName = new Map(
      baselineFingerprints.current.tables.map(table => [table.name, table]),
    );
    const preByName = new Map(
      baselineFingerprints.preGeneration.tables.map(table => [
        table.name,
        table,
      ]),
    );
    expect([...currentByName.keys()].sort()).toEqual(
      [...preByName.keys()].sort(),
    );

    for (const [name, currentTable] of currentByName) {
      const preTable = preByName.get(name);
      expect(preTable).toBeDefined();
      if (name === "asset_gc_lock") {
        expect(currentTable.columns.map(column => column.name)).toEqual([
          "id",
          "owner",
          "generation",
          "acquired_at",
          "expires_at",
        ]);
        expect(preTable!.columns.map(column => column.name)).toEqual([
          "id",
          "owner",
          "acquired_at",
          "expires_at",
        ]);
        expect(currentTable.indexes).toEqual(preTable!.indexes);
        expect(currentTable.foreignKeys).toEqual(preTable!.foreignKeys);
        continue;
      }
      expect(preTable).toEqual(currentTable);
    }
  });

  it("classifies an unexpected table as unknown", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "schema-fp-unknown-"));
    tempDirs.push(tempDir);

    const copied = copyLegacyR1Fixture(tempDir);
    const db = new Database(copied.dbPath);
    try {
      db.exec("CREATE TABLE unexpected(id TEXT)");
      const classification = classifyLedgerlessDatabase(db);
      expect(classification.kind).toBe("unknown");
      if (classification.kind === "unknown") {
        expect(classification.difference.length).toBeGreaterThan(0);
        expect(classification.difference).not.toMatch(
          /@legacy|owner@|user-legacy|project-legacy/i,
        );
      }
    } finally {
      db.close();
    }
  });

  it("classifies a CHECK-altered table as unknown", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "schema-fp-check-"));
    tempDirs.push(tempDir);

    const copied = copyLegacyR1Fixture(tempDir);
    const db = new Database(copied.dbPath);
    try {
      db.pragma("foreign_keys = OFF");
      db.exec(`
        CREATE TABLE organizations_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active','suspended','archived')),
          created_at TEXT NOT NULL
        );
        INSERT INTO organizations_new SELECT id, name, status, created_at FROM organizations;
        DROP TABLE organizations;
        ALTER TABLE organizations_new RENAME TO organizations;
      `);
      db.pragma("foreign_keys = ON");
      const classification = classifyLedgerlessDatabase(db);
      expect(classification).toEqual(
        expect.objectContaining({kind: "unknown"}),
      );
      if (classification.kind === "unknown") {
        expect(classification.difference).toMatch(/organizations|sql|CHECK/i);
      }
    } finally {
      db.close();
    }
  });

  it("preserves whitespace inside quoted SQL string literals during normalization", () => {
    const db = new Database(":memory:");
    dbs.push(db);
    db.exec(`CREATE TABLE spaced_check (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL CHECK(label = 'a  b')
    )`);

    const fingerprint = captureSchemaFingerprint(db);
    expect(fingerprint.tables).toHaveLength(1);
    expect(fingerprint.tables[0]?.sql).toContain("'a  b'");
    expect(fingerprint.tables[0]?.sql).not.toContain("'a b'");
  });

  it("returns identical fingerprints for repeated capture", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "schema-fp-stable-"));
    tempDirs.push(tempDir);

    const copied = copyLegacyR1Fixture(tempDir);
    const db = new Database(copied.dbPath);
    try {
      const first = captureSchemaFingerprint(db);
      const second = captureSchemaFingerprint(db);
      expect(second).toEqual(first);
    } finally {
      db.close();
    }
  });
});
