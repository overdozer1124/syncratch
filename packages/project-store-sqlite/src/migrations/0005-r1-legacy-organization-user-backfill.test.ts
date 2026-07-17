import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "./0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "./0003-r1-school-roster.js";
import {r1AccessImportAuditMigration} from "./0004-r1-access-import-audit.js";
import {
  r1LegacyOrganizationUserBackfillChecksumSource,
  r1LegacyOrganizationUserBackfillMigration,
} from "./0005-r1-legacy-organization-user-backfill.js";
import {computeLegacyBackfillPlan} from "./backfill/plan.js";
import {readLegacyBackfillSource} from "./backfill/source.js";
import {
  LEGACY_BACKFILL_TARGET_TABLES,
} from "./backfill/source.js";
import {r1LegacyOrganizationUserBackfillChecksum} from "./backfill/v5-descriptor.js";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";
import {
  type MigrationFaultPoint,
  runSchemaMigrationsWithOptions,
} from "./runner.js";
import {SchemaMigrationError} from "./types.js";

const APPLIED_AT = "2026-07-18T00:00:00.000Z";
const V4_APPLIED_AT = "2026-07-17T00:00:00.000Z";
const HARD_CODED_CHECKSUM =
  "c88745d2f32c1f59426bc83a58254e8ce77dd876e93fda075449d6f297cd2e08";

const migrationsDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(migrationsDir, "../fixtures/legacy-r1.sqlite");

const v1ThroughV4 = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
] as const;

const v1ThroughV5 = [
  ...v1ThroughV4,
  r1LegacyOrganizationUserBackfillMigration,
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

function createTempDir(prefix = "blocksync-v5-"): string {
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

function migrateThroughV4(db: Database.Database): void {
  runSchemaMigrationsWithOptions(db, {
    migrations: v1ThroughV4,
    now: () => V4_APPLIED_AT,
  });
}

function openEmptyV4File(): {
  db: Database.Database;
  dbPath: string;
  tempDir: string;
} {
  const tempDir = createTempDir();
  const dbPath = join(tempDir, "empty.sqlite");
  const db = openTracked(dbPath);
  migrateThroughV4(db);
  return {db, dbPath, tempDir};
}

function sortById<Row extends {id: string}>(rows: readonly Row[]): Row[] {
  return [...rows].sort((left, right) =>
    Buffer.compare(Buffer.from(left.id, "utf8"), Buffer.from(right.id, "utf8")),
  );
}

function openCopiedLegacyV4(): {
  db: Database.Database;
  dbPath: string;
  tempDir: string;
} {
  const tempDir = createTempDir();
  const dbPath = join(tempDir, "legacy.sqlite");
  copyFileSync(fixturePath, dbPath);
  const db = openTracked(dbPath);
  migrateThroughV4(db);
  return {db, dbPath, tempDir};
}

function backupNames(tempDir: string): string[] {
  return readdirSync(tempDir).filter(name => name.includes(".pre-v5."));
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

function sessionRows(db: Database.Database): unknown[] {
  return db
    .prepare(
      `SELECT id_hash, revoked_at FROM sessions ORDER BY id_hash`,
    )
    .all();
}

function ledgerVersions(db: Database.Database): number[] {
  return db
    .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
    .pluck()
    .all() as number[];
}

describe("0005 r1-legacy-organization-user-backfill descriptor", () => {
  it("has immutable version/name/checksum", () => {
    expect(r1LegacyOrganizationUserBackfillMigration.version).toBe(5);
    expect(r1LegacyOrganizationUserBackfillMigration.name).toBe(
      "r1-legacy-organization-user-backfill",
    );
    expect(r1LegacyOrganizationUserBackfillMigration.checksumSource).toBe(
      r1LegacyOrganizationUserBackfillChecksumSource,
    );
    expect(r1LegacyOrganizationUserBackfillChecksumSource).toBe(
      [
        "version=5",
        "name=r1-legacy-organization-user-backfill",
        "prepare:verified-vacuum-backup-v1",
        "validate:legacy-backfill-source-v1",
        "identity:uuidv5-5382ca4a-3efd-5013-bbff-25dc72876ebf",
        "insert:workspaces,user_accounts,people,person_account_links",
        "insert:workspace_memberships,workspace_directory_revisions,role_assignments",
        "update:sessions-revoke-unrevoked",
        "guard:locked-legacy-digest",
      ].join("\n"),
    );
    expect(r1LegacyOrganizationUserBackfillMigration.checksum).toBe(
      HARD_CODED_CHECKSUM,
    );
    expect(r1LegacyOrganizationUserBackfillMigration.checksum).toBe(
      r1LegacyOrganizationUserBackfillChecksum,
    );
    expect(r1LegacyOrganizationUserBackfillMigration.checksum).toBe(
      computeMigrationChecksum(r1LegacyOrganizationUserBackfillChecksumSource),
    );
  });
});

describe("0005 r1-legacy-organization-user-backfill apply", () => {
  it("creates a verified backup and inserts every planned target row", () => {
    const {db, tempDir} = openCopiedLegacyV4();
    const sourceBefore = readLegacyBackfillSource(db);
    const plan = computeLegacyBackfillPlan(sourceBefore, {
      appliedAt: APPLIED_AT,
    });
    const previouslyRevoked = sourceBefore.sessions
      .filter(row => row.revoked_at !== null)
      .map(row => ({id_hash: row.id_hash, revoked_at: row.revoked_at}));

    runSchemaMigrationsWithOptions(db, {
      migrations: v1ThroughV5,
      now: () => APPLIED_AT,
    });

    expect(backupNames(tempDir)).toHaveLength(1);
    expect(existsSync(join(tempDir, backupNames(tempDir)[0]!))).toBe(true);
    expect(db.pragma("user_version", {simple: true})).toBe(5);
    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

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

    const sessions = sessionRows(db) as Array<{
      id_hash: string;
      revoked_at: string | null;
    }>;
    for (const idHash of plan.sessionIdsToRevoke) {
      expect(sessions.find(row => row.id_hash === idHash)?.revoked_at).toBe(
        APPLIED_AT,
      );
    }
    for (const prior of previouslyRevoked) {
      expect(sessions.find(row => row.id_hash === prior.id_hash)?.revoked_at).toBe(
        prior.revoked_at,
      );
    }
  });

  it("performs no target DML for empty preparation", () => {
    const {db, tempDir} = openEmptyV4File();

    runSchemaMigrationsWithOptions(db, {
      migrations: v1ThroughV5,
      now: () => APPLIED_AT,
    });

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
    expect(db.pragma("user_version", {simple: true})).toBe(5);
    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects already_applied preparation while version 5 is still pending", () => {
    const {db} = openCopiedLegacyV4();

    expect(() =>
      r1LegacyOrganizationUserBackfillMigration.apply(
        db,
        {appliedAt: APPLIED_AT},
        {kind: "already_applied", backupPath: "unused.sqlite"},
      ),
    ).toThrowError(
      expect.objectContaining({
        name: "SchemaMigrationError",
        code: "SCHEMA_BACKFILL_INVALID",
      }),
    );
    expect(targetCounts(db)).toEqual({
      workspaces: 0,
      user_accounts: 0,
      people: 0,
      person_account_links: 0,
      workspace_memberships: 0,
      workspace_directory_revisions: 0,
      role_assignments: 0,
    });
    expect(db.pragma("user_version", {simple: true})).toBe(4);
  });

  it("rechecks the locked live digest before any target DML", () => {
    const {db, tempDir} = openCopiedLegacyV4();
    const migration = {
      ...r1LegacyOrganizationUserBackfillMigration,
      prepare(
        migrationDb: Database.Database,
        context: {appliedAt: string},
      ) {
        const preparation =
          r1LegacyOrganizationUserBackfillMigration.prepare!(
            migrationDb,
            context,
          );
        migrationDb
          .prepare(`UPDATE organizations SET name = ? WHERE id = ?`)
          .run(
            "mutated-after-prepare",
            (
              migrationDb
                .prepare(`SELECT id FROM organizations ORDER BY id LIMIT 1`)
                .get() as {id: string}
            ).id,
          );
        return preparation;
      },
    };

    let thrown: unknown;
    try {
      runSchemaMigrationsWithOptions(db, {
        migrations: [...v1ThroughV4, migration],
        now: () => APPLIED_AT,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SchemaMigrationError);
    expect((thrown as SchemaMigrationError).code).toBe(
      "SCHEMA_BACKFILL_INVALID",
    );
    expect(targetCounts(db)).toEqual({
      workspaces: 0,
      user_accounts: 0,
      people: 0,
      person_account_links: 0,
      workspace_memberships: 0,
      workspace_directory_revisions: 0,
      role_assignments: 0,
    });
    expect(db.pragma("user_version", {simple: true})).toBe(4);
    expect(ledgerVersions(db)).toEqual([1, 2, 3, 4]);
    expect(backupNames(tempDir)).toHaveLength(1);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS row_count FROM sessions WHERE revoked_at IS NULL`,
          )
          .get() as {row_count: number}
      ).row_count,
    ).toBeGreaterThan(0);
  });

  it.each([
    "after_apply_before_ledger",
    "after_ledger_before_user_version",
  ] as const)(
    "rolls back target rows and session revocation at %s, then retries equivalently",
    (faultPoint: MigrationFaultPoint) => {
      const {db, dbPath, tempDir} = openCopiedLegacyV4();
      const oneShotPath = join(tempDir, "one-shot.sqlite");
      copyFileSync(dbPath, oneShotPath);
      const oneShot = openTracked(oneShotPath);

      const marker = new Error(`fault:${faultPoint}`);
      expect(() =>
        runSchemaMigrationsWithOptions(db, {
          migrations: v1ThroughV5,
          now: () => APPLIED_AT,
          fault: point => {
            if (point === faultPoint) throw marker;
          },
        }),
      ).toThrow(marker);

      expect(targetCounts(db)).toEqual({
        workspaces: 0,
        user_accounts: 0,
        people: 0,
        person_account_links: 0,
        workspace_memberships: 0,
        workspace_directory_revisions: 0,
        role_assignments: 0,
      });
      expect(ledgerVersions(db)).toEqual([1, 2, 3, 4]);
      expect(db.pragma("user_version", {simple: true})).toBe(4);
      expect(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS row_count FROM sessions WHERE revoked_at IS NULL`,
            )
            .get() as {row_count: number}
        ).row_count,
      ).toBeGreaterThan(0);
      const backupsAfterFault = backupNames(tempDir);
      expect(backupsAfterFault.length).toBeGreaterThanOrEqual(1);
      for (const name of backupsAfterFault) {
        expect(existsSync(join(tempDir, name))).toBe(true);
      }

      runSchemaMigrationsWithOptions(oneShot, {
        migrations: v1ThroughV5,
        now: () => APPLIED_AT,
      });
      runSchemaMigrationsWithOptions(db, {
        migrations: v1ThroughV5,
        now: () => APPLIED_AT,
      });

      expect(db.pragma("user_version", {simple: true})).toBe(5);
      expect(ledgerVersions(db)).toEqual([1, 2, 3, 4, 5]);
      expect(readTargetSnapshot(db)).toEqual(readTargetSnapshot(oneShot));
      expect(sessionRows(db)).toEqual(sessionRows(oneShot));
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(backupNames(tempDir).length).toBeGreaterThanOrEqual(2);
    },
  );
});
