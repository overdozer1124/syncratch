import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StubAuthContext } from "@blocksync/auth-context";
import {
  contentHash,
  customProcedureFixtureDocument,
  emptyDocument,
  richFixtureDocument,
} from "@blocksync/project-envelope";
import {
  SchemaInvalidError,
  SchemaVersionMismatchError,
  SnapshotHashMismatchError,
  StaleRevisionError,
  TransactionPayloadMismatchError,
  NotFoundError,
  AssetNotLiveError,
  BadRequestError,
  ImportPreconditionError,
  createMemoryProjectRepository,
  createMemorySnapshotStore,
  createMemoryImportAtomicRepository,
  createMemoryLiveAssetByteStore,
  createMemoryLiveAssetCatalog,
  createProjectService,
} from "./index.js";

const userA = { headers: { "x-user-id": "user-a" } };
const userB = { headers: { "x-user-id": "user-b" } };

function makeService(options?: {
  commitAssets?: ReturnType<typeof createMemoryLiveAssetCatalog>;
  assetBytes?: ReturnType<typeof createMemoryLiveAssetByteStore>;
  importAtomic?: ReturnType<typeof createMemoryImportAtomicRepository>;
}) {
  const repo = createMemoryProjectRepository();
  const snapshots = createMemorySnapshotStore();
  const service = createProjectService({
    auth: new StubAuthContext(),
    repo,
    snapshots,
    commitAssets: options?.commitAssets,
    assetBytes: options?.assetBytes,
    importAtomic: options?.importAtomic,
    now: () => new Date("2026-07-15T00:00:00.000Z"),
    idFactory: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  return { service, repo, snapshots };
}

function seedDocumentAssets(
  catalog: ReturnType<typeof createMemoryLiveAssetCatalog>,
  byteStore: ReturnType<typeof createMemoryLiveAssetByteStore>,
  organizationId: string,
  document: ReturnType<typeof customProcedureFixtureDocument>,
): void {
  let index = 0;
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      const bytes = new TextEncoder().encode(`asset-bytes-${index++}`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const md5Hex = createHash("md5").update(bytes).digest("hex");
      const canonical = costume.dataFormat === "jpeg" ? "jpg" : costume.dataFormat;
      costume.contentSha256 = sha256;
      costume.assetId = md5Hex;
      costume.md5ext = `${md5Hex}.${canonical}`;
      catalog.seedAsset(organizationId, {
        sha256,
        byteLength: bytes.length,
        md5Hex,
        dataFormat: canonical,
        gcState: "live",
      });
      byteStore.files.set(sha256, bytes);
    }
    for (const sound of target.sounds ?? []) {
      const bytes = new TextEncoder().encode(`asset-bytes-${index++}`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const md5Hex = createHash("md5").update(bytes).digest("hex");
      const canonical = sound.dataFormat === "jpeg" ? "jpg" : sound.dataFormat;
      sound.contentSha256 = sha256;
      sound.assetId = md5Hex;
      sound.md5ext = `${md5Hex}.${canonical}`;
      catalog.seedAsset(organizationId, {
        sha256,
        byteLength: bytes.length,
        md5Hex,
        dataFormat: canonical,
        gcState: "live",
      });
      byteStore.files.set(sha256, bytes);
    }
  }
}


describe("project-service", () => {
  it("lists only member projects for same-org users", async () => {
    const { service } = makeService();
    await service.createProject(userA, { title: "A" });
    const listA = await service.listProjects(userA);
    const listB = await service.listProjects(userB);
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(0);
  });

  it("denies non-member get/save", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    await expect(service.getProject(userB, created.projectId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      service.saveDocument(userB, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "t1",
        schemaVersion: 1,
        document: richFixtureDocument(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("idempotent save returns same revision without bump", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    const doc = richFixtureDocument();
    const first = await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-1",
      schemaVersion: 1,
      document: doc,
    });
    expect(first.revision).toBe(1);
    const second = await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-1",
      schemaVersion: 1,
      document: doc,
    });
    expect(second.revision).toBe(1);
    expect(second.contentHash).toBe(first.contentHash);
    const head = await service.getProject(userA, created.projectId);
    expect(head.revision).toBe(1);
  });

  it("same transactionId with different schemaVersion mismatches", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    const doc = emptyDocument();
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-sv",
      schemaVersion: 1,
      document: doc,
    });
    const badDoc = { ...doc, schemaVersion: 2 };
    // schema mismatch vs document fails first when client lies inconsistently;
    // use matching document schema but different request schema via clone trick:
    // For mismatch after success, re-send same doc with different schemaVersion that equals doc —
    // need same document bytes but different schemaVersion in request → SchemaVersionMismatch.
    // Plan: same transactionId, same document, different schemaVersion that still equals document
    // is impossible. So change only request schemaVersion with matching doc.schemaVersion change
    // after first save — document hash would also change. Explicit case from plan:
    // "same transactionId, same document, different schemaVersion"
    // That means payload material differs while contentHash of doc may be same if schemaVersion
    // is also in document — so contentHash changes too. requestHash still mismatches first.
    // Simulate by calling find path: recreate with altered schemaVersion on same doc identity
    // after first commit — recompute with doc.schemaVersion=1 and request schemaVersion=1 succeeded;
    // second call with schemaVersion=1 and mutated meta still same content is hard.
    // Direct case: second call uses schemaVersion 1 and a copy of doc with schemaVersion 1 but
    // content change → TransactionPayloadMismatch.

    const other = structuredClone(doc);
    other.meta = { x: 1 };
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-sv",
        schemaVersion: 1,
        document: other,
      }),
    ).rejects.toBeInstanceOf(TransactionPayloadMismatchError);

    // schemaVersion-only change: valid V2 document on replay with same transactionId
    const sv2 = customProcedureFixtureDocument();
    const assets = createMemoryLiveAssetCatalog();
    const assetBytes = createMemoryLiveAssetByteStore();
    seedDocumentAssets(assets, assetBytes, "org-demo", sv2);
    const { service: svc2 } = makeService({ commitAssets: assets, assetBytes });
    const created2 = await svc2.createProject(userA, { title: "A2" });
    await svc2.saveDocument(userA, {
      projectId: created2.projectId,
      baseRevision: 0,
      transactionId: "tx-sv-v2",
      schemaVersion: 1,
      document: doc,
    });
    await expect(
      svc2.saveDocument(userA, {
        projectId: created2.projectId,
        baseRevision: 0,
        transactionId: "tx-sv-v2",
        schemaVersion: 2,
        document: sv2,
      }),
    ).rejects.toBeInstanceOf(TransactionPayloadMismatchError);
  });

  it("rejects client schemaVersion !== document.schemaVersion", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-mm",
        schemaVersion: 2,
        document: emptyDocument(),
      }),
    ).rejects.toBeInstanceOf(SchemaVersionMismatchError);
  });

  it("stale revision leaves head unchanged", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    const doc = richFixtureDocument();
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-ok",
      schemaVersion: 1,
      document: doc,
    });
    const headBefore = await service.getProject(userA, created.projectId);
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-stale",
        schemaVersion: 1,
        document: emptyDocument(),
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    const headAfter = await service.getProject(userA, created.projectId);
    expect(headAfter.revision).toBe(headBefore.revision);
    expect(headAfter.contentHash).toBe(headBefore.contentHash);
  });

  it("rejects invalid document", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-bad",
        schemaVersion: 1,
        document: {
          schemaVersion: 1,
          targets: [
            {
              id: "s1",
              name: "S",
              isStage: false,
              blocks: {
                a: {
                  id: "mismatch",
                  opcode: "event_whenflagclicked",
                  next: null,
                  parent: null,
                  inputs: {},
                  fields: {},
                  topLevel: true,
                },
              },
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(SchemaInvalidError);
  });

  it("save rejects schemaVersion 1 document with V2-only block mutation", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "V1 gate" });
    const doc = richFixtureDocument();
    doc.targets[1]!.blocks.hat!.mutation = { proccode: "not on v1" };
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-v1-mutation",
        schemaVersion: 1,
        document: doc,
      }),
    ).rejects.toBeInstanceOf(SchemaInvalidError);
  });

  it("save rejects V2 document with unknown top-level field", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "Unknown field" });
    const doc = customProcedureFixtureDocument();
    (doc as unknown as Record<string, unknown>).hidden = true;
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-unknown",
        schemaVersion: 2,
        document: doc,
      }),
    ).rejects.toBeInstanceOf(SchemaInvalidError);
  });

  it("save rejects V2 document with currentCostume but no costumes", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "Incomplete V2" });
    const doc = customProcedureFixtureDocument();
    delete doc.targets[1]!.costumes;
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-no-costumes",
        schemaVersion: 2,
        document: doc,
      }),
    ).rejects.toBeInstanceOf(SchemaInvalidError);
  });

  it("snapshot restore creates new revision; BOLA across projects fails", async () => {
    const { service } = makeService();
    const a = await service.createProject(userA, { title: "A", projectId: "proj-a" });
    const b = await service.createProject(userA, { title: "B", projectId: "proj-b" });
    const snapDoc = richFixtureDocument();
    await service.saveDocument(userA, {
      projectId: a.projectId,
      baseRevision: 0,
      transactionId: "tx-a1",
      schemaVersion: 1,
      document: snapDoc,
    });
    const snap = await service.createSnapshot(userA, { projectId: a.projectId });

    await service.saveDocument(userA, {
      projectId: a.projectId,
      baseRevision: 1,
      transactionId: "tx-a2",
      schemaVersion: 1,
      document: emptyDocument(),
    });

    const restored = await service.restoreSnapshot(userA, {
      projectId: a.projectId,
      snapshotId: snap.snapshotId,
      baseRevision: 2,
      transactionId: "tx-restore",
      schemaVersion: 1,
    });
    expect(restored.revision).toBe(3);
    expect(restored.contentHash).toBe(contentHash(snapDoc));
    expect(restored.revisionMeta).toEqual({
      op: "restore",
      snapshotId: snap.snapshotId,
    });

    await expect(
      service.restoreSnapshot(userA, {
        projectId: b.projectId,
        snapshotId: snap.snapshotId,
        baseRevision: 0,
        transactionId: "tx-bola",
        schemaVersion: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("can snapshot the same head twice and restore either", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "Snap2" });
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-s0",
      schemaVersion: 1,
      document: richFixtureDocument(),
    });
    const first = await service.createSnapshot(userA, { projectId: created.projectId });
    const second = await service.createSnapshot(userA, { projectId: created.projectId });
    expect(first.snapshotId).not.toBe(second.snapshotId);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.storageKey).toBe(second.storageKey);

    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 1,
      transactionId: "tx-diverge",
      schemaVersion: 1,
      document: emptyDocument(),
    });

    const r1 = await service.restoreSnapshot(userA, {
      projectId: created.projectId,
      snapshotId: first.snapshotId,
      baseRevision: 2,
      transactionId: "tx-r1",
      schemaVersion: 1,
    });
    const r2 = await service.restoreSnapshot(userA, {
      projectId: created.projectId,
      snapshotId: second.snapshotId,
      baseRevision: 3,
      transactionId: "tx-r2",
      schemaVersion: 1,
    });
    expect(r1.contentHash).toBe(first.contentHash);
    expect(r2.contentHash).toBe(second.contentHash);
    expect(r1.revisionMeta?.op).toBe("restore");
    expect(r2.revisionMeta?.op).toBe("restore");
  });

  it("restore replay returns stored envelope after blob deletion", async () => {
    const { service, snapshots } = makeService();
    const created = await service.createProject(userA, { title: "Replay" });
    const doc = richFixtureDocument();
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-doc",
      schemaVersion: 1,
      document: doc,
    });
    const snap = await service.createSnapshot(userA, {
      projectId: created.projectId,
    });
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 1,
      transactionId: "tx-div",
      schemaVersion: 1,
      document: emptyDocument(),
    });

    const first = await service.restoreSnapshot(userA, {
      projectId: created.projectId,
      snapshotId: snap.snapshotId,
      baseRevision: 2,
      transactionId: "tx-restore-idem",
      schemaVersion: 1,
    });
    expect(first.revision).toBe(3);

    expect(snapshots.files.delete(snap.storageKey)).toBe(true);

    const replay = await service.restoreSnapshot(userA, {
      projectId: created.projectId,
      snapshotId: snap.snapshotId,
      baseRevision: 2,
      transactionId: "tx-restore-idem",
      schemaVersion: 1,
    });
    expect(replay.revision).toBe(first.revision);
    expect(replay.contentHash).toBe(first.contentHash);
    expect(replay.revisionMeta).toEqual(first.revisionMeta);

    await expect(
      service.restoreSnapshot(userA, {
        projectId: created.projectId,
        snapshotId: snap.snapshotId,
        baseRevision: 2,
        transactionId: "tx-restore-idem",
        schemaVersion: 2,
      }),
    ).rejects.toBeInstanceOf(TransactionPayloadMismatchError);
  });

  it("rejects byte-hash mismatch and invalid snapshot JSON as SnapshotHashMismatchError", async () => {
    const { service, snapshots, repo } = makeService();
    const created = await service.createProject(userA, { title: "Corrupt" });
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-c0",
      schemaVersion: 1,
      document: richFixtureDocument(),
    });
    const snap = await service.createSnapshot(userA, {
      projectId: created.projectId,
    });
    snapshots.files.set(snap.storageKey, new TextEncoder().encode("{not-json"));
    await expect(
      service.restoreSnapshot(userA, {
        projectId: created.projectId,
        snapshotId: snap.snapshotId,
        baseRevision: 1,
        transactionId: "tx-bad-hash",
        schemaVersion: 1,
      }),
    ).rejects.toBeInstanceOf(SnapshotHashMismatchError);

    const corruptBytes = new TextEncoder().encode("{not-json");
    const corruptHash = createHash("sha256").update(corruptBytes).digest("hex");
    const storageKey = `${corruptHash}.json`;
    snapshots.files.set(storageKey, corruptBytes);
    repo.withTransaction((tx) => {
      tx.insertSnapshotMeta({
        snapshotId: "corrupt-json",
        projectId: created.projectId,
        basedOnRevision: 1,
        reason: "manual",
        contentHash: corruptHash,
        storageKey,
        createdBy: "user-a",
        createdAt: "2026-07-15T00:00:00.000Z",
      });
    });
    await expect(
      service.restoreSnapshot(userA, {
        projectId: created.projectId,
        snapshotId: "corrupt-json",
        baseRevision: 1,
        transactionId: "tx-bad-json",
        schemaVersion: 1,
      }),
    ).rejects.toBeInstanceOf(SnapshotHashMismatchError);
  });

  it("rolls back memory transaction on forced error", async () => {
    const { service, repo } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    repo.failNextTransaction = true;
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-rb",
        schemaVersion: 1,
        document: richFixtureDocument(),
      }),
    ).rejects.toThrow(/FORCED_ROLLBACK/);
    const head = await service.getProject(userA, created.projectId);
    expect(head.revision).toBe(0);
  });

  it("save rejects a V2 document when commit-time live check fails", async () => {
    const commitAssets = createMemoryLiveAssetCatalog();
    const assetBytes = createMemoryLiveAssetByteStore();
    const { service } = makeService({ commitAssets, assetBytes });
    const created = await service.createProject(userA, { title: "Assets" });
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(commitAssets, assetBytes, "org-demo", doc);
    const sha = doc.targets[0]!.costumes![0]!.contentSha256;
    commitAssets.quarantineOnCommit.add(sha);

    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-asset-live",
        schemaVersion: 2,
        document: doc,
      }),
    ).rejects.toBeInstanceOf(AssetNotLiveError);

    const head = await service.getProject(userA, created.projectId);
    expect(head.revision).toBe(0);
  });

  it("save returns NotFoundError for non-member before asset verification", async () => {
    const commitAssets = createMemoryLiveAssetCatalog();
    const assetBytes = createMemoryLiveAssetByteStore();
    const { service } = makeService({ commitAssets, assetBytes });
    const created = await service.createProject(userA, { title: "Secret" });
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(commitAssets, assetBytes, "org-demo", doc);
    commitAssets.quarantineOnCommit.add(doc.targets[0]!.costumes![0]!.contentSha256);

    await expect(
      service.saveDocument(userB, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-bola-asset",
        schemaVersion: 2,
        document: doc,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("importSb3Project delegates to importAtomic without using createProject", async () => {
    const importAtomic = createMemoryImportAtomicRepository();
    const assetBytes = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    const catalog = createMemoryLiveAssetCatalog();
    seedDocumentAssets(catalog, assetBytes, "org-demo", doc);
    const assetObjects = doc.targets.flatMap((target) => [
      ...(target.costumes ?? []).map((costume) => ({
        sha256: costume.contentSha256,
        byteLength: assetBytes.files.get(costume.contentSha256)!.length,
        md5Hex: costume.assetId,
        dataFormat: costume.dataFormat,
      })),
      ...(target.sounds ?? []).map((sound) => ({
        sha256: sound.contentSha256,
        byteLength: assetBytes.files.get(sound.contentSha256)!.length,
        md5Hex: sound.assetId,
        dataFormat: sound.dataFormat,
      })),
    ]);
    const { service, repo } = makeService({ importAtomic, assetBytes });
    const envelope = {
      format: "blocksync.project/v1" as const,
      projectId: "imported-proj",
      organizationId: "org-demo",
      title: "Imported SB3",
      revision: 0,
      schemaVersion: 2,
      contentHash: contentHash(doc),
      updatedAt: "2026-07-15T00:00:00.000Z",
      updatedByUserId: "user-a",
      document: doc,
    };

    const result = await service.importSb3Project(userA, {
      projectId: "imported-proj",
      title: "Imported SB3",
      envelope,
      assetObjects,
      releaseImportSessionId: "session-1",
      fileBytes: 100,
    });

    expect(result).toEqual(envelope);
    expect(importAtomic.calls).toHaveLength(1);
    expect(importAtomic.calls[0]?.grantShas.sort()).toEqual(
      assetObjects.map((asset) => asset.sha256).sort(),
    );
    expect(repo.withTransaction(() => 0)).toBe(0);
  });

  it("importSb3Project rejects envelope tenant mismatch before atomic import", async () => {
    const importAtomic = createMemoryImportAtomicRepository();
    const assetBytes = createMemoryLiveAssetByteStore();
    const { service } = makeService({ importAtomic, assetBytes });
    const doc = customProcedureFixtureDocument();
    const envelope = {
      format: "blocksync.project/v1" as const,
      projectId: "imported-proj",
      organizationId: "other-org",
      title: "Imported SB3",
      revision: 0,
      schemaVersion: 2,
      contentHash: contentHash(doc),
      updatedAt: "2026-07-15T00:00:00.000Z",
      updatedByUserId: "user-a",
      document: doc,
    };

    await expect(
      service.importSb3Project(userA, {
        projectId: "imported-proj",
        title: "Imported SB3",
        envelope,
        assetObjects: [],
        releaseImportSessionId: "session-1",
        fileBytes: 0,
      }),
    ).rejects.toBeInstanceOf(ImportPreconditionError);
    expect(importAtomic.calls).toHaveLength(0);
  });

  it("importSb3Project rejects asset metadata mismatch before atomic import", async () => {
    const importAtomic = createMemoryImportAtomicRepository();
    const assetBytes = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    const catalog = createMemoryLiveAssetCatalog();
    seedDocumentAssets(catalog, assetBytes, "org-demo", doc);
    const assetObjects = doc.targets.flatMap((target) => [
      ...(target.costumes ?? []).map((costume) => ({
        sha256: costume.contentSha256,
        byteLength: assetBytes.files.get(costume.contentSha256)!.length,
        md5Hex: costume.assetId,
        dataFormat: costume.dataFormat,
      })),
      ...(target.sounds ?? []).map((sound) => ({
        sha256: sound.contentSha256,
        byteLength: assetBytes.files.get(sound.contentSha256)!.length,
        md5Hex: sound.assetId,
        dataFormat: sound.dataFormat,
      })),
    ]);
    assetObjects[0] = {
      ...assetObjects[0]!,
      md5Hex: "f".repeat(32),
      dataFormat: "png",
    };
    const { service } = makeService({ importAtomic, assetBytes });
    const envelope = {
      format: "blocksync.project/v1" as const,
      projectId: "imported-proj",
      organizationId: "org-demo",
      title: "Imported SB3",
      revision: 0,
      schemaVersion: 2,
      contentHash: contentHash(doc),
      updatedAt: "2026-07-15T00:00:00.000Z",
      updatedByUserId: "user-a",
      document: doc,
    };

    await expect(
      service.importSb3Project(userA, {
        projectId: "imported-proj",
        title: "Imported SB3",
        envelope,
        assetObjects,
        releaseImportSessionId: "session-1",
        fileBytes: 100,
      }),
    ).rejects.toBeInstanceOf(ImportPreconditionError);
    expect(importAtomic.calls).toHaveLength(0);
  });

  it("save with asset refs requires asset verification deps", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "Need assets" });
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-no-catalog",
        schemaVersion: 2,
        document: customProcedureFixtureDocument(),
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
