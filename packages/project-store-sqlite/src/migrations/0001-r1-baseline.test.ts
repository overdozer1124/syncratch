import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import baselineFingerprints from "./r1-baseline-fingerprints.json" with {
  type: "json",
};
import {captureSchemaFingerprint} from "./schema-fingerprint.js";

const dbs: Database.Database[] = [];

function withImmediateTransaction(
  db: Database.Database,
  fn: () => void,
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name) as {ok: number} | undefined;
  return row !== undefined;
}

describe("r1 baseline migration 0001", () => {
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it("exposes the immutable descriptor checksum contract", () => {
    expect(r1BaselineMigration.version).toBe(1);
    expect(r1BaselineMigration.name).toBe("r1-baseline");
    expect(r1BaselineMigration.checksumSource).toBe(
      [
        "version=1",
        "name=r1-baseline",
        "createProjectSchema:v1",
        "createAuthSchema:v1",
        "createAssetSchema:v1-with-generation",
      ].join("\n"),
    );
    expect(r1BaselineMigration.checksum).toBe(
      "1b5519ca38da1711db8f7b7cc6da07ff55532471ee0934fa2fe0d5e2b2153362",
    );
    expect(
      computeMigrationChecksum(r1BaselineMigration.checksumSource),
    ).toBe(r1BaselineMigration.checksum);
  });

  it("applies the accepted current schema on a fresh configured database", () => {
    const db = new Database(":memory:");
    dbs.push(db);
    configureSqliteConnection(db);

    let applyResult: unknown = "not-called";
    withImmediateTransaction(db, () => {
      applyResult = r1BaselineMigration.apply(db);
    });

    expect(applyResult).toBeUndefined();
    expect(captureSchemaFingerprint(db)).toEqual(baselineFingerprints.current);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const generationColumn = (
      db.pragma("table_info(asset_gc_lock)") as Array<{
        name: string;
        dflt_value: string | null;
      }>
    ).find(column => column.name === "generation");
    expect(generationColumn?.dflt_value).toBe("1");

    expect(tableExists(db, "schema_migrations")).toBe(false);
    expect(tableExists(db, "workspaces")).toBe(false);
    expect(tableExists(db, "people")).toBe(false);
    expect(tableExists(db, "person_account_links")).toBe(false);
    expect(tableExists(db, "workspace_memberships")).toBe(false);
  });
});
