import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAssetFsStore,
  contentSha256,
  writeRawLiveAsset,
} from "@blocksync/project-assets-fs";
import {
  canonicalizeDocument,
  contentHash,
} from "@blocksync/project-envelope";
import { validateProject, type ProjectDocument } from "@blocksync/project-schema";
import {
  createFsSnapshotStore,
  writeRawSnapshotFile,
} from "@blocksync/project-snapshots-fs";
import {
  createSqliteAssetRepository,
  migrate,
  migrateAssets,
  migrateAuth,
  AssetGcLockLostError,
  createAssetGcLockHandle,
  QUARANTINE_GRACE_MS,
  seedActiveAssetGcLock,
  seedStaleAssetGcLock,
  withAssetGcLock,
} from "@blocksync/project-store-sqlite";
import { bootstrapPersistRuntime } from "./bootstrap.js";
import {
  buildSnapshotGcContext,
  GcScanFailedError,
  quarantineOrphanLiveAssets,
  quarantineUnreferencedAsset,
  reconcileAssetGcState,
  runAssetGcCycle,
} from "./gc.js";
import { reconcilePersistBoot } from "./reconcile.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function md5(n: number): string {
  return n.toString(16).padStart(32, "a").slice(-32);
}

function shaFromSeed(seed: number): { sha256: string; bytes: Uint8Array } {
  const bytes = new Uint8Array(64);
  bytes.fill(seed & 0xff);
  return { sha256: contentSha256(bytes), bytes };
}

function docReferencingSha(sha256: string): ProjectDocument {
  const assetId = sha256.slice(0, 32);
  const doc: ProjectDocument = {
    schemaVersion: 2,
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "c1",
            assetId,
            md5ext: `${assetId}.png`,
            dataFormat: "png",
            contentSha256: sha256,
            rotationCenterX: 0,
            rotationCenterY: 0,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null,
      },
    ],
    extensions: [],
    monitors: [],
  };
  expect(validateProject(doc).ok).toBe(true);
  return doc;
}

function insertSnapshot(
  db: Database.Database,
  snapshotStore: ReturnType<typeof createFsSnapshotStore>,
  args: {
    projectId: string;
    document: ProjectDocument;
    now: string;
  },
): string {
  const hash = contentHash(args.document);
  const bytes = new TextEncoder().encode(canonicalizeDocument(args.document));
  const { storageKey } = snapshotStore.putAtomic(hash, bytes);
  db.prepare(
    `INSERT INTO project_snapshots (
      id, project_id, based_on_revision, reason, content_hash, storage_key,
      created_by, created_at
    ) VALUES ('snap-1', ?, 0, 'manual', ?, ?, 'u1', ?)`,
  ).run(args.projectId, hash, storageKey, args.now);
  return hash;
}

function revisionEnvelope(
  document: ProjectDocument,
  now: string,
  projectId = "p1",
): string {
  return JSON.stringify({
    format: "blocksync.project/v1",
    projectId,
    organizationId: "org-1",
    title: "T",
    revision: 0,
    schemaVersion: document.schemaVersion,
    contentHash: contentHash(document),
    updatedAt: now,
    updatedByUserId: "u1",
    document,
  });
}

describe("asset GC", () => {
  it("runAssetGcCycle quarantines unreferenced live assets", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: orphan, bytes } = shaFromSeed(10);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'live', ?)`,
    ).run(orphan, md5(1), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(orphan, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const snapshotStore = createFsSnapshotStore(join(dir, "snapshots"));
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(readDb, snapshotStore);

    const result = runAssetGcCycle(repo, assetFs, ctx, now, { snapshotStore });
    expect(result.quarantined).toBe(1);
    expect(assetFs.quarantineExists(orphan)).toBe(true);
    expect(assetFs.liveExists(orphan)).toBe(false);
    const checkDb = new Database(dbPath, { readonly: true });
    expect(
      checkDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(orphan),
    ).toEqual({ s: "quarantined" });
    readDb.close();
    checkDb.close();
    repoDb.close();
  });

  it("does not GC assets referenced only by snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-snapshot-ref-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);

    const { sha256: snapshotOnly, bytes: snapshotBytes } = shaFromSeed(20);
    const { sha256: orphan, bytes: orphanBytes } = shaFromSeed(21);
    for (const [sha, label] of [
      [snapshotOnly, md5(20)],
      [orphan, md5(21)],
    ] as const) {
      db.prepare(
        `INSERT INTO asset_objects (
          sha256, byte_length, md5_hex, data_format, gc_state, created_at
        ) VALUES (?, 64, ?, 'png', 'live', ?)`,
      ).run(sha, label, now);
    }

    const snapshotStore = createFsSnapshotStore(join(dir, "snapshots"));
    insertSnapshot(db, snapshotStore, {
      projectId: "p1",
      document: docReferencingSha(snapshotOnly),
      now,
    });
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(snapshotOnly, snapshotBytes);
    assetFs.putIfAbsent(orphan, orphanBytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(readDb, snapshotStore);

    expect(ctx.documentShas.has(snapshotOnly)).toBe(true);
    const result = runAssetGcCycle(repo, assetFs, ctx, now, { snapshotStore });
    expect(result.quarantined).toBe(1);
    expect(assetFs.liveExists(snapshotOnly)).toBe(true);
    expect(assetFs.quarantineExists(orphan)).toBe(true);

    readDb.close();
    repoDb.close();
  });

  it("buildSnapshotGcContext fails closed on missing snapshot blob", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-scan-fail-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO project_snapshots (
        id, project_id, based_on_revision, reason, content_hash, storage_key,
        created_by, created_at
      ) VALUES ('snap-1', 'p1', 0, 'manual', 'missing', 'missing.json', 'u1', ?)`,
    ).run(now);
    db.close();

    const readDb = new Database(dbPath, { readonly: true });
    expect(() =>
      buildSnapshotGcContext(
        readDb,
        createFsSnapshotStore(join(dir, "snapshots")),
      ),
    ).toThrow(GcScanFailedError);
    readDb.close();
  });

  it("startup reconcile recovers crashed GC mid quarantining with live file", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-reconcile-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: assetSha, bytes } = shaFromSeed(11);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantining', ?)`,
    ).run(assetSha, md5(1), now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    const doc = docReferencingSha(assetSha);
    db.prepare(
      `INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at
      ) VALUES ('p1', 0, ?, ?, 'r', 'u1', ?)`,
    ).run(revisionEnvelope(doc, now), contentHash(doc), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    reconcilePersistBoot({
      assetRepo: repo,
      assetFs,
      dbPath,
      snapshotStore: createFsSnapshotStore(join(dir, "snapshots")),
    });

    const checkDb = new Database(dbPath, { readonly: true });
    expect(
      checkDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "live" });
    expect(
      checkDb
        .prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ c: 1 });
    expect(assetFs.liveExists(assetSha)).toBe(true);
    expect(assetFs.quarantineExists(assetSha)).toBe(false);
    checkDb.close();
    repoDb.close();
  });

  it("reconcileAssetGcState keeps referenced quarantining live file on live path", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-reconcile-ref-live-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: assetSha, bytes } = shaFromSeed(31);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantining', ?)`,
    ).run(assetSha, md5(1), now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    const doc = docReferencingSha(assetSha);
    db.prepare(
      `INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at
      ) VALUES ('p1', 0, ?, ?, 'r', 'u1', ?)`,
    ).run(revisionEnvelope(doc, now), contentHash(doc), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(
      readDb,
      createFsSnapshotStore(join(dir, "snapshots")),
    );
    readDb.close();

    reconcileAssetGcState(repo, assetFs, ctx, now);

    expect(
      repoDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "live" });
    expect(
      repoDb
        .prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ c: 1 });
    expect(assetFs.liveExists(assetSha)).toBe(true);
    expect(assetFs.quarantineExists(assetSha)).toBe(false);
    repoDb.close();
  });

  it("reconcileAssetGcState completes unreferenced quarantining live file to quarantined", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-reconcile-unref-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: assetSha, bytes } = shaFromSeed(32);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantining', ?)`,
    ).run(assetSha, md5(1), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(
      readDb,
      createFsSnapshotStore(join(dir, "snapshots")),
    );
    readDb.close();

    reconcileAssetGcState(repo, assetFs, ctx, now);

    expect(
      repoDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "quarantined" });
    expect(assetFs.liveExists(assetSha)).toBe(false);
    expect(assetFs.quarantineExists(assetSha)).toBe(true);
    repoDb.close();
  });

  it("reconcileAssetGcState dual presence restores referenced live and drops quarantine orphan", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-dual-ref-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: assetSha, bytes } = shaFromSeed(33);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantining', ?)`,
    ).run(assetSha, md5(1), now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    const doc = docReferencingSha(assetSha);
    db.prepare(
      `INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at
      ) VALUES ('p1', 0, ?, ?, 'r', 'u1', ?)`,
    ).run(revisionEnvelope(doc, now), contentHash(doc), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    assetFs.moveLiveToQuarantine(assetSha);
    writeRawLiveAsset(join(dir, "assets"), assetSha, bytes);
    expect(assetFs.liveExists(assetSha)).toBe(true);
    expect(assetFs.quarantineExists(assetSha)).toBe(true);

    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(
      readDb,
      createFsSnapshotStore(join(dir, "snapshots")),
    );
    readDb.close();

    reconcileAssetGcState(repo, assetFs, ctx, now);

    expect(
      repoDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "live" });
    expect(assetFs.liveExists(assetSha)).toBe(true);
    expect(assetFs.quarantineExists(assetSha)).toBe(false);
    repoDb.close();
  });

  it("reconcileAssetGcState dual presence marks unreferenced quarantined and drops live duplicate", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-dual-unref-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: assetSha, bytes } = shaFromSeed(34);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantining', ?)`,
    ).run(assetSha, md5(1), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    assetFs.moveLiveToQuarantine(assetSha);
    writeRawLiveAsset(join(dir, "assets"), assetSha, bytes);

    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(
      readDb,
      createFsSnapshotStore(join(dir, "snapshots")),
    );
    readDb.close();

    reconcileAssetGcState(repo, assetFs, ctx, now);

    expect(
      repoDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "quarantined" });
    expect(assetFs.liveExists(assetSha)).toBe(false);
    expect(assetFs.quarantineExists(assetSha)).toBe(true);
    repoDb.close();
  });

  it("bootstrap runs GC cycle and quarantines unreferenced live assets", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-boot-cycle-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: orphan, bytes } = shaFromSeed(12);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'live', ?)`,
    ).run(orphan, md5(1), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(orphan, bytes);

    const runtime = bootstrapPersistRuntime(dir, {
      env: { ...process.env, R1_AUTH_MODE: "stub", R1_ALLOWED_ORIGINS: "" },
    });
    try {
      expect(assetFs.quarantineExists(orphan)).toBe(true);
      expect(assetFs.liveExists(orphan)).toBe(false);
      const checkDb = new Database(dbPath, { readonly: true });
      expect(
        checkDb
          .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
          .get(orphan),
      ).toEqual({ s: "quarantined" });
      checkDb.close();
    } finally {
      runtime.close();
    }
  });

  it("quarantineOrphanLiveAssets respects grace and does not delete immediately", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-orphan-grace-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    const { sha256: orphan, bytes } = shaFromSeed(13);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    writeRawLiveAsset(assetFs.assetsRoot, orphan, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);

    const quarantined = quarantineOrphanLiveAssets(repo, assetFs, now);
    expect(quarantined).toBe(1);
    expect(assetFs.quarantineExists(orphan)).toBe(true);
    expect(repo.listQuarantinedReadyForDeletion(now)).toEqual([]);

    const afterGrace = new Date(
      Date.parse(now) + QUARANTINE_GRACE_MS + 1000,
    ).toISOString();
    expect(repo.listQuarantinedReadyForDeletion(afterGrace)).toEqual([orphan]);

    repoDb.close();
  });

  it("reconcile deletes quarantined row when both files are missing after crash", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-crash-row-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    const { sha256: assetSha } = shaFromSeed(14);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, quarantine_started_at, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantined', ?, ?)`,
    ).run(assetSha, md5(1), now, now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    reconcilePersistBoot({
      assetRepo: repo,
      assetFs,
      dbPath,
      snapshotStore: createFsSnapshotStore(join(dir, "snapshots")),
    });

    const checkDb = new Database(dbPath, { readonly: true });
    expect(
      checkDb
        .prepare(`SELECT COUNT(*) AS c FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ c: 0 });
    checkDb.close();
    repoDb.close();
  });

  it("GC scan failure prevents quarantine during boot", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-scan-block-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: orphan, bytes } = shaFromSeed(15);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'live', ?)`,
    ).run(orphan, md5(1), now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO project_snapshots (
        id, project_id, based_on_revision, reason, content_hash, storage_key,
        created_by, created_at
      ) VALUES ('snap-bad', 'p1', 0, 'manual', 'bad', 'bad.json', 'u1', ?)`,
    ).run(now);
    writeRawSnapshotFile(
      join(dir, "snapshots"),
      "bad.json",
      new TextEncoder().encode("{not valid json"),
    );
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(orphan, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const boot = reconcilePersistBoot({
      assetRepo: repo,
      assetFs,
      dbPath,
      snapshotStore: createFsSnapshotStore(join(dir, "snapshots")),
    });

    expect(boot.gcScanFailed).toBe(true);
    expect(boot.gcCycle).toBeNull();
    expect(assetFs.liveExists(orphan)).toBe(true);
    repoDb.close();
  });

  it("quarantineOrphanLiveAssets rejects hijacked assetsRoot", () => {
    const realRoot = mkdtempSync(join(tmpdir(), "r1-gc-orphan-real-"));
    const outside = mkdtempSync(join(tmpdir(), "r1-gc-orphan-outside-"));
    dirs.push(outside);
    const dbPath = join(realRoot, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    db.close();

    const assetsRoot = join(realRoot, "assets");
    const assetFs = createAssetFsStore(assetsRoot);
    const { sha256: orphan, bytes } = shaFromSeed(16);
    writeRawLiveAsset(assetsRoot, orphan, bytes);

    rmSync(assetsRoot, { recursive: true, force: true });
    symlinkSync(outside, assetsRoot, "junction");

    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    expect(() =>
      quarantineOrphanLiveAssets(repo, assetFs, new Date().toISOString()),
    ).toThrow(/ASSETS_ROOT_REALPATH_CHANGED|SYMLINK_NOT_ALLOWED/);
    repoDb.close();
    rmSync(assetsRoot, { force: true });
    rmSync(realRoot, { recursive: true, force: true });
  });

  it("bootstrap reconcile removes expired reservations", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-boot-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    createSqliteAssetRepository(db).createGlobalDiskReservation({
      reservationId: "expired",
      importSessionId: "expired-session",
      reservedBytes: 1024,
      fileBytes: 0,
      now,
    });
    db.close();
    const updateDb = new Database(dbPath);
    updateDb
      .prepare(`UPDATE global_disk_reservations SET expires_at = ?`)
      .run(new Date(Date.parse(now) - 60_000).toISOString());
    updateDb.close();

    const runtime = bootstrapPersistRuntime(dir, {
      env: { ...process.env, R1_AUTH_MODE: "stub", R1_ALLOWED_ORIGINS: "" },
    });
    try {
      const checkDb = new Database(dbPath, { readonly: true });
      expect(
        checkDb
          .prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`)
          .get(),
      ).toEqual({ c: 0 });
      checkDb.close();
    } finally {
      runtime.close();
    }
  });

  it("adopts orphan quarantine files with grace instead of immediate delete", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-orphan-q-adopt-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    db.close();

    const now = new Date().toISOString();
    const { sha256: orphan, bytes } = shaFromSeed(17);
    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(orphan, bytes);
    assetFs.moveLiveToQuarantine(orphan);

    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const boot = reconcilePersistBoot({
      assetRepo: repo,
      assetFs,
      dbPath,
      snapshotStore: createFsSnapshotStore(join(dir, "snapshots")),
      now: () => new Date(now),
    });

    expect(boot.gc?.orphanQuarantineRowsAdopted).toBe(1);
    expect(assetFs.quarantineExists(orphan)).toBe(true);
    expect(repo.listQuarantinedReadyForDeletion(now)).toEqual([]);
    repoDb.close();
  });

  it("corrupt revision scan fails closed and skips GC quarantine", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-rev-scan-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: orphan, bytes } = shaFromSeed(18);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'live', ?)`,
    ).run(orphan, md5(1), now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at
      ) VALUES ('p1', 0, ?, 'h', 'r', 'u1', ?)`,
    ).run(JSON.stringify({ format: "blocksync.project/v1" }), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(orphan, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    try {
      const boot = reconcilePersistBoot({
        assetRepo: repo,
        assetFs,
        dbPath,
        snapshotStore: createFsSnapshotStore(join(dir, "snapshots")),
      });

      expect(boot.gcScanFailed).toBe(true);
      expect(assetFs.liveExists(orphan)).toBe(true);
    } finally {
      repoDb.close();
    }
  });

  it("recovers stale sqlite gc lock and still runs GC cycle", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-stale-lock-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: orphan, bytes } = shaFromSeed(19);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'live', ?)`,
    ).run(orphan, md5(1), now);
    seedStaleAssetGcLock(db, "dead-worker", now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(orphan, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const boot = reconcilePersistBoot({
      assetRepo: repo,
      assetFs,
      dbPath,
      snapshotStore: createFsSnapshotStore(join(dir, "snapshots")),
      now: () => new Date(now),
    });

    expect(boot.gcLock).toBe("ran");
    expect(boot.gcCycle?.quarantined).toBe(1);
    expect(assetFs.quarantineExists(orphan)).toBe(true);
    repoDb.close();
  });

  it("skips quarantine when revision is committed after scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-race-revision-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    const { sha256: assetSha, bytes } = shaFromSeed(21);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'live', ?)`,
    ).run(assetSha, md5(1), now);
    db.close();

    const snapshotStore = createFsSnapshotStore(join(dir, "snapshots"));
    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(readDb, snapshotStore);
    readDb.close();

    const writeDb = new Database(dbPath);
    const doc = docReferencingSha(assetSha);
    writeDb.prepare(
      `INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at
      ) VALUES ('p1', 0, ?, ?, 'r', 'u1', ?)`,
    ).run(revisionEnvelope(doc, now), contentHash(doc), now);
    writeDb.close();

    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const outcome = quarantineUnreferencedAsset(repo, assetFs, assetSha, ctx, {
      snapshotStore,
      now,
    });
    expect(outcome).toBe("skipped");
    expect(assetFs.liveExists(assetSha)).toBe(true);
    repoDb.close();
  });

  it("boot reconcile skips GC mutations while another worker holds lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-boot-lock-skip-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    const { sha256: assetSha, bytes } = shaFromSeed(22);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantining', ?)`,
    ).run(assetSha, md5(1), now);
    const doc = docReferencingSha(assetSha);
    db.prepare(
      `INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at
      ) VALUES ('p1', 0, ?, ?, 'r', 'u1', ?)`,
    ).run(revisionEnvelope(doc, now), contentHash(doc), now);
    seedActiveAssetGcLock(db, "runtime-worker", now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const boot = reconcilePersistBoot({
      assetRepo: repo,
      assetFs,
      dbPath,
      snapshotStore: createFsSnapshotStore(join(dir, "snapshots")),
      now: () => new Date(now),
    });

    expect(boot.gcLock).toBe("skipped");
    expect(boot.gc).toBeNull();
    expect(boot.gcCycle).toBeNull();
    expect(boot.orphanLiveQuarantined).toBe(0);
    const checkDb = new Database(dbPath, { readonly: true });
    expect(
      checkDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "quarantining" });
    expect(assetFs.liveExists(assetSha)).toBe(true);
    checkDb.close();
    repoDb.close();
  });

  it("sqlite gc lock serializes two database connections", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-lock-two-conn-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    seedStaleAssetGcLock(db, "dead-worker", now);
    db.close();

    const dbA = new Database(dbPath);
    const dbB = new Database(dbPath);
    const repoA = createSqliteAssetRepository(dbA);
    const repoB = createSqliteAssetRepository(dbB);

    expect(repoA.tryAcquireAssetGcLock("worker-a", now).outcome).toBe(
      "acquired",
    );
    expect(withAssetGcLock(repoB, "worker-b", now, () => {})).toBe("skipped");
    const genA = (
      dbA.prepare(`SELECT generation AS g FROM asset_gc_lock WHERE id = 1`).get() as {
        g: number;
      }
    ).g;
    expect(repoA.releaseAssetGcLock("worker-a", genA)).toBe(true);
    expect(withAssetGcLock(repoB, "worker-b", now, () => {})).toBe("ran");

    dbA.close();
    dbB.close();
  });

  it("aborts GC cycle after lease takeover by another worker", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-lease-takeover-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    const { sha256: orphan, bytes } = shaFromSeed(23);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'live', ?)`,
    ).run(orphan, md5(1), now);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(orphan, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const snapshotStore = createFsSnapshotStore(join(dir, "snapshots"));
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(readDb, snapshotStore);
    readDb.close();

    const acquiredA = repo.tryAcquireAssetGcLock("worker-a", now);
    expect(acquiredA.outcome).toBe("acquired");
    if (acquiredA.outcome === "skipped") return;
    const lock = createAssetGcLockHandle(
      repo,
      "worker-a",
      acquiredA.generation,
    );
    const expiredAt = new Date(Date.parse(now) - 1_000).toISOString();
    repoDb
      .prepare(`UPDATE asset_gc_lock SET expires_at = ? WHERE id = 1`)
      .run(expiredAt);
    expect(repo.tryAcquireAssetGcLock("worker-b", now).outcome).toBe("acquired");

    expect(() => lock.renewOrAbort()).toThrow(AssetGcLockLostError);
    expect(() =>
      runAssetGcCycle(repo, assetFs, ctx, now, {
        snapshotStore,
        lock: { ...lock, ...repo },
      }),
    ).toThrow(AssetGcLockLostError);
    expect(assetFs.liveExists(orphan)).toBe(true);
    expect(assetFs.quarantineExists(orphan)).toBe(false);

    repoDb.close();
  });

  it("converges when stale worker completes FS move during takeover reconcile", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-stale-move-interleave-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const bootNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(bootNow);
    const { sha256: assetSha, bytes } = shaFromSeed(25);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantining', ?)`,
    ).run(assetSha, md5(1), bootNow);
    db.close();

    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(
      readDb,
      createFsSnapshotStore(join(dir, "snapshots")),
    );
    readDb.close();

    const acquiredB = repo.tryAcquireAssetGcLock(
      "worker-b",
      bootNow,
    );
    expect(acquiredB.outcome).toBe("acquired");
    if (acquiredB.outcome === "skipped") return;
    const handleB = createAssetGcLockHandle(
      repo,
      "worker-b",
      acquiredB.generation,
    );

    repo.reconcileQuarantiningRow({
      sha256: assetSha,
      readFsState: () => ({
        liveExists: true,
        quarantineExists: false,
      }),
      now: bootNow,
      snapshotDocumentShas: ctx.documentShas,
      snapshotOrganizationIds: [],
      fence: handleB.fence(),
    });
    const midDb = new Database(dbPath, { readonly: true });
    expect(
      midDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "quarantining" });
    midDb.close();

    const move = assetFs.moveLiveToQuarantine(assetSha);
    expect(move.moved).toBe(true);

    repo.finishAssetQuarantineAfterRename(
      assetSha,
      {
        moved: false,
        liveHadFile: false,
        quarantineHadFile: true,
      },
      bootNow,
      handleB.fence(),
    );

    const checkDb = new Database(dbPath, { readonly: true });
    expect(
      checkDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "quarantined" });
    expect(assetFs.liveExists(assetSha)).toBe(false);
    expect(assetFs.quarantineExists(assetSha)).toBe(true);
    expect(
      checkDb
        .prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ c: 0 });
    checkDb.close();
    repo.releaseAssetGcLock("worker-b", acquiredB.generation);
    repoDb.close();
  });

  it("rejects stale fence finish after takeover during in-flight quarantine", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-fence-interleave-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const bootNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(bootNow);
    const { sha256: assetSha, bytes } = shaFromSeed(24);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (?, 64, ?, 'png', 'quarantining', ?)`,
    ).run(assetSha, md5(1), bootNow);
    db.close();

    let nowMs = Date.parse(bootNow);
    const clock = () => new Date(nowMs);
    const assetFs = createAssetFsStore(join(dir, "assets"));
    assetFs.putIfAbsent(assetSha, bytes);
    const move = assetFs.moveLiveToQuarantine(assetSha);
    expect(move.moved).toBe(true);

    const repoDb = new Database(dbPath);
    const repo = createSqliteAssetRepository(repoDb);
    const staleFence = {
      owner: "worker-a",
      generation: 1,
      clock,
    };
    expect(() =>
      repo.finishAssetQuarantineAfterRename(assetSha, move, bootNow, staleFence),
    ).toThrow(AssetGcLockLostError);

    const acquiredB = repo.tryAcquireAssetGcLock("worker-b", clock().toISOString());
    expect(acquiredB.outcome).toBe("acquired");
    if (acquiredB.outcome === "skipped") return;
    const handleB = createAssetGcLockHandle(
      repo,
      "worker-b",
      acquiredB.generation,
      clock,
    );
    const readDb = new Database(dbPath, { readonly: true });
    const ctx = buildSnapshotGcContext(
      readDb,
      createFsSnapshotStore(join(dir, "snapshots")),
    );
    readDb.close();
    reconcileAssetGcState(repo, assetFs, ctx, bootNow, handleB);

    const checkDb = new Database(dbPath, { readonly: true });
    expect(
      checkDb
        .prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`)
        .get(assetSha),
    ).toEqual({ s: "quarantined" });
    expect(assetFs.liveExists(assetSha)).toBe(false);
    expect(assetFs.quarantineExists(assetSha)).toBe(true);
    checkDb.close();
    repoDb.close();
  });

  it("rejects non-canonical snapshot bytes via raw hash mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-gc-raw-hash-"));
    dirs.push(dir);
    const dbPath = join(dir, "projects.sqlite");
    const db = new Database(dbPath);
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
    const now = new Date().toISOString();
    const doc = docReferencingSha(shaFromSeed(20).sha256);
    const canonicalHash = contentHash(doc);
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO project_snapshots (
        id, project_id, based_on_revision, reason, content_hash, storage_key,
        created_by, created_at
      ) VALUES ('snap-1', 'p1', 0, 'manual', ?, 'snap-1.json', 'u1', ?)`,
    ).run(canonicalHash, now);
    writeRawSnapshotFile(
      join(dir, "snapshots"),
      "snap-1.json",
      new TextEncoder().encode('{"schemaVersion":2,"targets":[]}'),
    );
    db.close();

    const readDb = new Database(dbPath, { readonly: true });
    expect(() =>
      buildSnapshotGcContext(
        readDb,
        createFsSnapshotStore(join(dir, "snapshots")),
      ),
    ).toThrow(/SNAPSHOT_RAW_HASH_MISMATCH/);
    readDb.close();
  });
});
