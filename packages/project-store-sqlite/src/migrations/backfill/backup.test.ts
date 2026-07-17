import {computeMigrationChecksum} from "../checksum.js";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {r1BaselineMigration} from "../0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "../0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "../0003-r1-school-roster.js";
import {r1AccessImportAuditMigration} from "../0004-r1-access-import-audit.js";
import {configureSqliteConnection} from "../configure.js";
import targetFingerprint from "../r1-target-schema-fingerprint.json" with {
  type: "json",
};
import {runSchemaMigrationsWithOptions} from "../runner.js";
import {
  captureSchemaFingerprint,
  fingerprintDifference,
} from "../schema-fingerprint.js";
import {SchemaMigrationError} from "../types.js";
import {prepareLegacyBackfillBackup} from "./backup.js";
import {captureLegacyDataDigest} from "./legacy-digest.js";

type BackupPreparationSeams = NonNullable<
  Parameters<typeof prepareLegacyBackfillBackup>[2]
>;

const migrationsDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(
  migrationsDir,
  "../../fixtures/legacy-r1.sqlite",
);
const context = {appliedAt: "2026-07-18T00:00:00.000Z"};
const v1ThroughV4 = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
] as const;
const v5Name = "r1-legacy-organization-user-backfill";
const v5Checksum = computeMigrationChecksum(
  [
    "version=5",
    `name=${v5Name}`,
    "prepare:verified-vacuum-backup-v1",
    "validate:legacy-backfill-source-v1",
    "identity:uuidv5-5382ca4a-3efd-5013-bbff-25dc72876ebf",
    "insert:workspaces,user_accounts,people,person_account_links",
    "insert:workspace_memberships,workspace_directory_revisions,role_assignments",
    "update:sessions-revoke-unrevoked",
    "guard:locked-legacy-digest",
  ].join("\n"),
);

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

function createTempDir(prefix = "blocksync-backup-"): string {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function migrateThroughV4(db: Database.Database): void {
  configureSqliteConnection(db);
  runSchemaMigrationsWithOptions(db, {
    migrations: v1ThroughV4,
    now: () => "2026-07-17T00:00:00.000Z",
  });
}

function openEmptyV4(path = ":memory:"): Database.Database {
  const db = new Database(path);
  dbs.push(db);
  migrateThroughV4(db);
  return db;
}

function openCopiedLegacyV4(prefix?: string): {
  db: Database.Database;
  dbPath: string;
  tempDir: string;
} {
  const tempDir = createTempDir(prefix);
  const dbPath = join(tempDir, "legacy.sqlite");
  copyFileSync(fixturePath, dbPath);
  const db = new Database(dbPath);
  dbs.push(db);
  migrateThroughV4(db);
  return {db, dbPath, tempDir};
}

function expectBackupFailure(fn: () => unknown): SchemaMigrationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaMigrationError);
    expect((error as SchemaMigrationError).code).toBe("SCHEMA_BACKUP_FAILED");
    return error as SchemaMigrationError;
  }
  throw new Error("Expected SCHEMA_BACKUP_FAILED");
}

function mutateBackup(
  mutation: (backup: Database.Database) => void,
): BackupPreparationSeams {
  return {
    afterVacuum(backupPath) {
      const backup = new Database(backupPath);
      try {
        mutation(backup);
      } finally {
        backup.close();
      }
    },
  };
}

function seedLegacyOrganization(db: Database.Database): void {
  db.prepare(
    `INSERT INTO organizations(id, name, status, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    "org-memory",
    "Memory organization",
    "active",
    "2026-07-17T00:00:00.000Z",
  );
}

describe("prepareLegacyBackfillBackup trigger", () => {
  it("returns empty for an empty in-memory v4 database", () => {
    const db = openEmptyV4();

    expect(prepareLegacyBackfillBackup(db, context)).toEqual({kind: "empty"});
  });

  it("fails when an in-memory v4 database contains legacy rows", () => {
    const db = openEmptyV4();
    seedLegacyOrganization(db);

    expectBackupFailure(() => prepareLegacyBackfillBackup(db, context));
  });

  it("creates no backup for a file database with all six trigger tables empty", () => {
    const tempDir = createTempDir();
    const db = openEmptyV4(join(tempDir, "empty.sqlite"));

    expect(prepareLegacyBackfillBackup(db, context)).toEqual({kind: "empty"});
    expect(readdirSync(tempDir).filter(name => name.includes(".pre-v5."))).toEqual(
      [],
    );
  });
});

describe("prepareLegacyBackfillBackup success", () => {
  it("creates an adjacent verified v4 backup of a copied legacy fixture", () => {
    const {db, dbPath} = openCopiedLegacyV4();
    const sourceDigest = captureLegacyDataDigest(db);

    const result = prepareLegacyBackfillBackup(db, context);

    expect(result.kind).toBe("verified");
    if (result.kind !== "verified") return;
    expect(result.backupPath.startsWith(`${dbPath}.pre-v5.`)).toBe(true);
    expect(result.backupPath).toMatch(
      /\.pre-v5\.20260718T000000000Z\.[0-9a-f]{16}\.sqlite$/,
    );
    expect(result.legacyDigest).toBe(sourceDigest);

    const backup = new Database(result.backupPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      backup.pragma("foreign_keys = ON");
      expect(backup.pragma("integrity_check", {simple: true})).toBe("ok");
      expect(backup.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(backup.pragma("user_version", {simple: true})).toBe(4);
      expect(
        fingerprintDifference(
          targetFingerprint.current,
          captureSchemaFingerprint(backup),
        ),
      ).toBeNull();
      expect(captureLegacyDataDigest(backup)).toBe(sourceDigest);
    } finally {
      backup.close();
    }
  });

  it("safely quotes apostrophes in the VACUUM INTO destination", () => {
    const {db} = openCopiedLegacyV4("blocksync-backup-'quote-");

    const result = prepareLegacyBackfillBackup(db, context);

    expect(result.kind).toBe("verified");
    if (result.kind === "verified") {
      expect(existsSync(result.backupPath)).toBe(true);
    }
  });

  it("uses a distinct random suffix for each preparation", () => {
    const first = openCopiedLegacyV4();
    const second = openCopiedLegacyV4();

    const firstResult = prepareLegacyBackfillBackup(first.db, context);
    const secondResult = prepareLegacyBackfillBackup(second.db, context);

    expect(firstResult.kind).toBe("verified");
    expect(secondResult.kind).toBe("verified");
    if (firstResult.kind === "verified" && secondResult.kind === "verified") {
      expect(firstResult.backupPath).not.toBe(secondResult.backupPath);
    }
  });
});

describe("prepareLegacyBackfillBackup failures", () => {
  it("does not overwrite or reuse a colliding destination", () => {
    const {db, tempDir} = openCopiedLegacyV4();
    const collisionPath = join(tempDir, "collision.sqlite");
    writeFileSync(collisionPath, "existing evidence", "utf8");

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(db, context, {
        destinationPath: () => collisionPath,
      }),
    );
    expect(readFileSync(collisionPath, "utf8")).toBe("existing evidence");
  });

  it("wraps VACUUM INTO failure and leaves no fabricated artifact", () => {
    const {db, tempDir} = openCopiedLegacyV4();
    const impossiblePath = join(tempDir, "missing", "backup.sqlite");

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(db, context, {
        destinationPath: () => impossiblePath,
      }),
    );
    expect(existsSync(impossiblePath)).toBe(false);
  });

  it("rejects an integrity-check mismatch", () => {
    const {db} = openCopiedLegacyV4();

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(
        db,
        context,
        mutateBackup(backup => {
          backup.pragma("writable_schema = ON");
          backup
            .prepare(
              `UPDATE sqlite_schema
               SET rootpage = 2147483647
               WHERE type = 'table' AND name = 'organizations'`,
            )
            .run();
          backup.pragma("writable_schema = OFF");
        }),
      ),
    );
  });

  it("rejects foreign-key violations", () => {
    const {db} = openCopiedLegacyV4();

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(
        db,
        context,
        mutateBackup(backup => {
          backup.pragma("foreign_keys = OFF");
          backup
            .prepare(
              `INSERT INTO organization_memberships(
                 organization_id, user_id, role
               ) VALUES ('missing-org', 'missing-user', 'member')`,
            )
            .run();
        }),
      ),
    );
  });

  it("rejects a user_version other than 4 or the exact race-only 5", () => {
    const {db} = openCopiedLegacyV4();

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(
        db,
        context,
        mutateBackup(backup => backup.pragma("user_version = 3")),
      ),
    );
  });

  it("rejects a v4 fingerprint mismatch and closes readonly verification in finally", () => {
    const {db, tempDir} = openCopiedLegacyV4();
    const destination = join(tempDir, "fingerprint-mismatch.sqlite");

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(db, context, {
        destinationPath: () => destination,
        ...mutateBackup(backup => {
          backup.exec("CREATE TABLE unexpected_backup_table(id TEXT)");
        }),
      }),
    );

    const moved = `${destination}.moved`;
    renameSync(destination, moved);
    expect(existsSync(moved)).toBe(true);
  });

  it("rejects a legacy digest mismatch", () => {
    const {db} = openCopiedLegacyV4();

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(
        db,
        context,
        mutateBackup(backup => {
          backup
            .prepare(
              `UPDATE organizations SET name = name || ' changed'
               WHERE id = (SELECT id FROM organizations ORDER BY id LIMIT 1)`,
            )
            .run();
        }),
      ),
    );
  });
});

describe("prepareLegacyBackfillBackup v5 race", () => {
  function completeLiveV5(db: Database.Database, checksum = v5Checksum): void {
    db.prepare(
      `INSERT INTO schema_migrations(version, name, checksum, applied_at)
       VALUES (5, ?, ?, ?)`,
    ).run(v5Name, checksum, context.appliedAt);
    db.pragma("user_version = 5");
  }

  const reportBackupVersionFive: BackupPreparationSeams = mutateBackup(
    backup => backup.pragma("user_version = 5"),
  );

  it("renames exactly once and returns already_applied for the exact live v5 ledger", () => {
    const {db} = openCopiedLegacyV4();
    let renameCount = 0;
    completeLiveV5(db);

    const result = prepareLegacyBackfillBackup(db, context, {
      ...reportBackupVersionFive,
      renameArtifact(from, to) {
        renameCount += 1;
        renameSync(from, to);
      },
    });

    expect(result.kind).toBe("already_applied");
    expect(renameCount).toBe(1);
    if (result.kind !== "already_applied") return;
    expect(result.backupPath).toMatch(/\.superseded-v5\.sqlite$/);
    expect(existsSync(result.backupPath)).toBe(true);
    expect(
      existsSync(result.backupPath.replace(/\.superseded-v5\.sqlite$/, ".sqlite")),
    ).toBe(false);
  });

  it("rejects backup version 5 when the exact live ledger row is missing", () => {
    const {db} = openCopiedLegacyV4();
    db.pragma("user_version = 5");

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(db, context, reportBackupVersionFive),
    );
  });

  it("rejects backup version 5 when the live ledger checksum mismatches", () => {
    const {db} = openCopiedLegacyV4();
    completeLiveV5(db, "0".repeat(64));

    expectBackupFailure(() =>
      prepareLegacyBackfillBackup(db, context, reportBackupVersionFive),
    );
  });
});
