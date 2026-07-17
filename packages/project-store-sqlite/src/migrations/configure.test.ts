import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";
import {SchemaMigrationError} from "./types.js";

const dbs: Database.Database[] = [];
const tempDirs: string[] = [];

describe("migration primitives", () => {
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });

  it("configures WAL, foreign keys and the bounded busy timeout without creating tables", () => {
    const db = new Database(":memory:");
    dbs.push(db);

    configureSqliteConnection(db);

    expect(db.pragma("journal_mode", {simple: true})).toBe("memory");
    expect(db.pragma("foreign_keys", {simple: true})).toBe(1);
    expect(db.pragma("busy_timeout", {simple: true})).toBe(5000);
    expect(
      db.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      ).all(),
    ).toEqual([]);
  });

  it("configures WAL for a file-backed database", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "blocksync-migration-"));
    tempDirs.push(tempDir);
    const db = new Database(join(tempDir, "store.sqlite"));
    dbs.push(db);

    configureSqliteConnection(db);

    expect(db.pragma("journal_mode", {simple: true})).toBe("wal");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid busy timeout %s",
    busyTimeoutMs => {
      const db = new Database(":memory:");
      dbs.push(db);

      expect(() =>
        configureSqliteConnection(db, {busyTimeoutMs}),
      ).toThrowError(
        new RangeError("busyTimeoutMs must be a non-negative integer"),
      );
    },
  );

  it("computes a stable lowercase SHA-256 checksum", () => {
    expect(computeMigrationChecksum("1\0r1-baseline\0create projects")).toBe(
      "7e43ccc54f0f9bf0a6aa530cde1a9139e92058d572840d9fbd4f0761480905be",
    );
  });

  it("returns a typed migration error without copying sensitive row data", () => {
    const error = new SchemaMigrationError(
      "SCHEMA_UNKNOWN_LEGACY",
      "table users differs",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SchemaMigrationError");
    expect(error.code).toBe("SCHEMA_UNKNOWN_LEGACY");
    expect(error.message).toBe("table users differs");
  });
});
