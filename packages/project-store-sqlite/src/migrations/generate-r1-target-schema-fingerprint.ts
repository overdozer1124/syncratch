import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "./0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "./0003-r1-school-roster.js";
import {r1AccessImportAuditMigration} from "./0004-r1-access-import-audit.js";
import {configureSqliteConnection} from "./configure.js";
import {runSchemaMigrationsWithOptions} from "./runner.js";
import {
  captureSchemaFingerprint,
  type SchemaFingerprint,
} from "./schema-fingerprint.js";

if (!process.argv.includes("--write")) {
  throw new Error(
    "Pass --write to replace packages/project-store-sqlite/src/migrations/r1-target-schema-fingerprint.json",
  );
}

interface R1TargetSchemaFingerprint {
  current: SchemaFingerprint;
}

const migrationsDir = dirname(fileURLToPath(import.meta.url));
const outputPath = join(migrationsDir, "r1-target-schema-fingerprint.json");
const tempRoot = mkdtempSync(join(tmpdir(), "blocksync-r1-target-fingerprint-"));

let db: Database.Database | undefined;

try {
  const dbPath = join(tempRoot, "store.sqlite");
  db = new Database(dbPath);
  configureSqliteConnection(db);
  runSchemaMigrationsWithOptions(db, {
    migrations: [
      r1BaselineMigration,
      r1IdentityCoreMigration,
      r1SchoolRosterMigration,
      r1AccessImportAuditMigration,
    ],
    now: () => "2026-07-17T00:00:00.000Z",
  });

  const payload: R1TargetSchemaFingerprint = {
    current: captureSchemaFingerprint(db),
  };

  db.close();
  db = undefined;

  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
} finally {
  db?.close();
  rmSync(tempRoot, {recursive: true, force: true});
}
