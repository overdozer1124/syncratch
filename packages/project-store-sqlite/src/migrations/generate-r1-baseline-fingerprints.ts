import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {copyLegacyR1Fixture} from "../fixtures/legacy-r1-manifest.js";
import {
  captureSchemaFingerprint,
  type SchemaFingerprint,
} from "./schema-fingerprint.js";

if (!process.argv.includes("--write")) {
  throw new Error(
    "Pass --write to replace packages/project-store-sqlite/src/migrations/r1-baseline-fingerprints.json",
  );
}

interface R1BaselineFingerprints {
  format: "blocksync.r1-schema-fingerprints/v1";
  current: SchemaFingerprint;
  preGeneration: SchemaFingerprint;
}

const migrationsDir = dirname(fileURLToPath(import.meta.url));
const outputPath = join(migrationsDir, "r1-baseline-fingerprints.json");
const tempRoot = mkdtempSync(join(tmpdir(), "blocksync-r1-fingerprints-"));

let currentDb: Database.Database | undefined;
let preGenerationDb: Database.Database | undefined;

try {
  const copied = copyLegacyR1Fixture(tempRoot);

  currentDb = new Database(copied.dbPath);
  const current = captureSchemaFingerprint(currentDb);
  currentDb.close();
  currentDb = undefined;

  preGenerationDb = new Database(copied.dbPath);
  preGenerationDb.exec("ALTER TABLE asset_gc_lock DROP COLUMN generation");
  const preGeneration = captureSchemaFingerprint(preGenerationDb);
  preGenerationDb.close();
  preGenerationDb = undefined;

  const payload: R1BaselineFingerprints = {
    format: "blocksync.r1-schema-fingerprints/v1",
    current,
    preGeneration,
  };

  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
} finally {
  currentDb?.close();
  preGenerationDb?.close();
  rmSync(tempRoot, {recursive: true, force: true});
}
