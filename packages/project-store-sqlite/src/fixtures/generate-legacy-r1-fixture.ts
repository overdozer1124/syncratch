import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {
  createLegacyR1Fixture,
  readLegacyR1Manifest,
  sha256File,
} from "./legacy-r1-fixture.js";

if (!process.argv.includes("--write")) {
  throw new Error("Pass --write to replace the committed legacy R1 fixture");
}

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const destinationDbPath = join(fixtureDir, "legacy-r1.sqlite");
const destinationSnapshotDir = join(fixtureDir, "legacy-r1-snapshots");
const destinationManifestPath = join(fixtureDir, "legacy-r1.manifest.json");
const temporaryRoot = mkdtempSync(join(tmpdir(), "blocksync-legacy-r1-"));
const temporaryDbPath = join(temporaryRoot, "projects.sqlite");
const temporarySnapshotDir = join(temporaryRoot, "snapshots");

try {
  await createLegacyR1Fixture({
    rootDir: temporaryRoot,
    dbPath: temporaryDbPath,
    snapshotDir: temporarySnapshotDir,
  });

  const checkpointDb = new Database(temporaryDbPath);
  try {
    checkpointDb.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    checkpointDb.close();
  }

  const sidecars = [`${temporaryDbPath}-wal`, `${temporaryDbPath}-shm`];
  const temporaryFiles = readdirSync(temporaryRoot).map(name =>
    join(temporaryRoot, name),
  );
  for (const sidecar of sidecars) {
    if (temporaryFiles.includes(sidecar)) {
      throw new Error(`SQLite sidecar remains after checkpoint: ${sidecar}`);
    }
  }

  const manifest = readLegacyR1Manifest(
    temporaryDbPath,
    temporarySnapshotDir,
  );
  const snapshotKeys = Object.keys(manifest.snapshotSha256);
  if (snapshotKeys.length !== 1 || manifest.snapshots.length !== 1) {
    throw new Error("Legacy R1 fixture must contain exactly one snapshot");
  }

  copyFileSync(temporaryDbPath, destinationDbPath);
  rmSync(destinationSnapshotDir, {recursive: true, force: true});
  mkdirSync(destinationSnapshotDir, {recursive: true});
  for (const storageKey of snapshotKeys) {
    copyFileSync(
      join(temporarySnapshotDir, storageKey),
      join(destinationSnapshotDir, storageKey),
    );
  }
  writeFileSync(
    destinationManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (sha256File(destinationDbPath) !== manifest.databaseSha256) {
    throw new Error("Copied legacy R1 database hash does not match manifest");
  }
  for (const [storageKey, expectedHash] of Object.entries(
    manifest.snapshotSha256,
  )) {
    if (
      sha256File(join(destinationSnapshotDir, storageKey)) !== expectedHash
    ) {
      throw new Error(
        `Copied legacy R1 snapshot hash does not match manifest: ${storageKey}`,
      );
    }
  }
} finally {
  rmSync(temporaryRoot, {recursive: true, force: true});
}
