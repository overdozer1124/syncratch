import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";
import {
  type MigrationFaultPoint,
  runSchemaMigrationsWithOptions,
} from "./runner.js";
import type {
  MigrationContext,
  SchemaMigration,
} from "./types.js";

const APPLIED_AT = "2026-07-18T00:00:00.000Z";
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

function openFileDb(): {db: Database.Database; dbPath: string} {
  const tempDir = mkdtempSync(join(tmpdir(), "blocksync-prepared-runner-"));
  tempDirs.push(tempDir);
  const dbPath = join(tempDir, "store.sqlite");
  const db = new Database(dbPath);
  dbs.push(db);
  configureSqliteConnection(db);
  return {db, dbPath};
}

function createMigration(
  partial: Pick<SchemaMigration, "version" | "name" | "apply"> &
    Partial<Pick<SchemaMigration, "prepare">>,
): SchemaMigration {
  const checksumSource =
    `version=${partial.version}\nname=${partial.name}\nbody`;
  return {
    ...partial,
    checksumSource,
    checksum: computeMigrationChecksum(checksumSource),
  };
}

function createBaselineMigration(
  apply?: SchemaMigration["apply"],
): SchemaMigration {
  return createMigration({
    version: 1,
    name: "baseline",
    apply:
      apply ??
      (db => {
        db.exec("CREATE TABLE baseline_marker(id INTEGER PRIMARY KEY)");
      }),
  });
}

function ledgerRows(db: Database.Database): unknown[] {
  return db
    .prepare(
      `SELECT version, name, checksum, applied_at
       FROM schema_migrations ORDER BY version`,
    )
    .all();
}

function seedBaseline(
  db: Database.Database,
  baseline: SchemaMigration,
): void {
  runSchemaMigrationsWithOptions(db, {
    migrations: [baseline],
    now: () => APPLIED_AT,
  });
}

describe("prepared migration runner lifecycle", () => {
  it("prepares a fresh prepared baseline before applying it", () => {
    const {db} = openFileDb();
    const events: string[] = [];
    const preparedBaseline = createMigration({
      version: 1,
      name: "prepared-baseline",
      prepare(migrationDb) {
        events.push("prepare");
        expect(migrationDb.inTransaction).toBe(false);
        return {token: "verified"};
      },
      apply(migrationDb, _context, preparation) {
        events.push("apply");
        expect(preparation).toEqual({token: "verified"});
        migrationDb.exec(
          "CREATE TABLE baseline_marker(id INTEGER PRIMARY KEY)",
        );
      },
    });

    runSchemaMigrationsWithOptions(db, {
      migrations: [preparedBaseline],
      now: () => APPLIED_AT,
    });

    expect(events).toEqual(["prepare", "apply"]);
    expect(ledgerRows(db)).toHaveLength(1);
  });

  it("passes one context to unprepared apply inside its transaction", () => {
    const {db} = openFileDb();
    let applyCalls = 0;
    let receivedContext: MigrationContext | undefined;
    const baseline = createBaselineMigration((migrationDb, context) => {
      applyCalls += 1;
      expect(migrationDb.inTransaction).toBe(true);
      receivedContext = context;
      migrationDb.exec(
        "CREATE TABLE baseline_marker(id INTEGER PRIMARY KEY)",
      );
    });

    runSchemaMigrationsWithOptions(db, {
      migrations: [baseline],
      now: () => APPLIED_AT,
    });

    expect(applyCalls).toBe(1);
    expect(receivedContext).toEqual({appliedAt: APPLIED_AT});
  });

  it("prepares outside a transaction and applies its result in a second transaction", () => {
    const {db} = openFileDb();
    const baseline = createBaselineMigration();
    let prepareContext: MigrationContext | undefined;
    let applyContext: MigrationContext | undefined;
    let receivedPreparation: unknown;
    const prepared = createMigration({
      version: 2,
      name: "prepared",
      prepare(migrationDb, context) {
        expect(migrationDb.inTransaction).toBe(false);
        expect(
          migrationDb
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .pluck()
            .all(),
        ).toEqual([1]);
        expect(context.appliedAt).toBe(APPLIED_AT);
        prepareContext = context;
        return {token: "verified"};
      },
      apply(migrationDb, context, preparation) {
        expect(migrationDb.inTransaction).toBe(true);
        applyContext = context;
        receivedPreparation = preparation;
        migrationDb.exec("CREATE TABLE prepared_marker(id INTEGER PRIMARY KEY)");
      },
    });

    runSchemaMigrationsWithOptions(db, {
      migrations: [baseline, prepared],
      now: () => APPLIED_AT,
    });

    expect(receivedPreparation).toEqual({token: "verified"});
    expect(applyContext).toBe(prepareContext);
    expect(ledgerRows(db)).toEqual([
      {
        version: 1,
        name: baseline.name,
        checksum: baseline.checksum,
        applied_at: APPLIED_AT,
      },
      {
        version: 2,
        name: prepared.name,
        checksum: prepared.checksum,
        applied_at: APPLIED_AT,
      },
    ]);
  });

  it("revalidates after preparation and skips apply when another connection records the migration", () => {
    const {db, dbPath} = openFileDb();
    const baseline = createBaselineMigration();
    seedBaseline(db, baseline);
    let applyCalls = 0;
    const prepared = createMigration({
      version: 2,
      name: "prepared-race",
      prepare() {
        const contender = new Database(dbPath);
        dbs.push(contender);
        configureSqliteConnection(contender);
        contender.exec("BEGIN IMMEDIATE");
        contender
          .prepare(
            `INSERT INTO schema_migrations(version, name, checksum, applied_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(2, prepared.name, prepared.checksum, APPLIED_AT);
        contender.pragma("user_version = 2");
        contender.exec("COMMIT");
        return {token: "superseded"};
      },
      apply() {
        applyCalls += 1;
      },
    });

    runSchemaMigrationsWithOptions(db, {
      migrations: [baseline, prepared],
      now: () => APPLIED_AT,
    });

    expect(applyCalls).toBe(0);
    expect(ledgerRows(db)).toHaveLength(2);
    expect(db.pragma("user_version", {simple: true})).toBe(2);
  });

  it("leaves ledger and user_version unchanged when preparation fails", () => {
    const {db} = openFileDb();
    const baseline = createBaselineMigration();
    seedBaseline(db, baseline);
    const beforeLedger = ledgerRows(db);
    const marker = new Error("preparation failed");
    const prepared = createMigration({
      version: 2,
      name: "prepared-failure",
      prepare() {
        throw marker;
      },
      apply() {
        throw new Error("apply must not run");
      },
    });

    expect(() =>
      runSchemaMigrationsWithOptions(db, {
        migrations: [baseline, prepared],
        now: () => APPLIED_AT,
      }),
    ).toThrow(marker);

    expect(ledgerRows(db)).toEqual(beforeLedger);
    expect(db.pragma("user_version", {simple: true})).toBe(1);
  });

  it("never prepares a ledgerless baseline adoption", () => {
    const {db} = openFileDb();
    r1BaselineMigration.apply(db);
    let prepareCalls = 0;
    let applyCalls = 0;
    const preparedBaseline: SchemaMigration = {
      ...r1BaselineMigration,
      prepare() {
        prepareCalls += 1;
      },
      apply() {
        applyCalls += 1;
      },
    };

    runSchemaMigrationsWithOptions(db, {
      migrations: [preparedBaseline],
      now: () => APPLIED_AT,
    });

    expect(prepareCalls).toBe(0);
    expect(applyCalls).toBe(0);
    expect(ledgerRows(db)).toEqual([
      {
        version: 1,
        name: r1BaselineMigration.name,
        checksum: r1BaselineMigration.checksum,
        applied_at: APPLIED_AT,
      },
    ]);
  });

  it.each([
    "after_apply_before_ledger",
    "after_ledger_before_user_version",
  ] as const)(
    "keeps prepared apply, ledger, and user_version atomic at %s",
    (faultPoint: MigrationFaultPoint) => {
      const {db} = openFileDb();
      const baseline = createBaselineMigration();
      seedBaseline(db, baseline);
      const marker = new Error(`fault:${faultPoint}`);
      const prepared = createMigration({
        version: 2,
        name: `prepared-${faultPoint}`,
        prepare() {
          return {token: "verified"};
        },
        apply(migrationDb) {
          migrationDb.exec(
            "CREATE TABLE prepared_marker(id INTEGER PRIMARY KEY)",
          );
        },
      });

      expect(() =>
        runSchemaMigrationsWithOptions(db, {
          migrations: [baseline, prepared],
          now: () => APPLIED_AT,
          fault: point => {
            if (point === faultPoint) throw marker;
          },
        }),
      ).toThrow(marker);

      expect(
        db
          .prepare(
            `SELECT 1 FROM sqlite_master
             WHERE type = 'table' AND name = 'prepared_marker'`,
          )
          .get(),
      ).toBeUndefined();
      expect(ledgerRows(db)).toHaveLength(1);
      expect(db.pragma("user_version", {simple: true})).toBe(1);
    },
  );
});
