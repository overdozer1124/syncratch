import { createHash, randomBytes } from "node:crypto";
import type { AssetFsStore } from "@blocksync/project-assets-fs";
import type { SnapshotStore } from "@blocksync/project-service";
import {
  type AssetGcLockHandle,
  type AssetGcLockRepository,
  AssetGcLockLostError,
  type AssetRepository,
  withAssetGcLock,
} from "@blocksync/project-store-sqlite";
import {
  buildGcScanContextFromDb,
  collectLiveReferencedShas,
  isSha256ReferencedLive,
} from "./gc-scan.js";
import {
  GcScanFailedError,
  type GcScanContext,
  type SnapshotGcContext,
} from "./gc-types.js";

export { GcScanFailedError, AssetGcLockLostError, type GcScanContext, type SnapshotGcContext };

export function buildGcScanContext(
  db: Parameters<typeof buildGcScanContextFromDb>[0],
  snapshotStore: SnapshotStore,
): GcScanContext {
  return buildGcScanContextFromDb(db, snapshotStore);
}

/** @deprecated Use buildGcScanContext */
export const buildSnapshotGcContext = buildGcScanContext;

export function organizationIdsForSha(
  ctx: GcScanContext,
  sha256: string,
): string[] {
  return [...(ctx.organizationIdsBySha.get(sha256) ?? [])];
}

export interface AssetGcRunResult {
  quarantined: number;
  skipped: number;
  deleted: number;
}

export interface AssetGcCycleOptions {
  snapshotStore: SnapshotStore;
  lock?: AssetGcLockHandle & AssetGcLockRepository;
}

export function quarantineUnreferencedAsset(
  assetRepo: AssetRepository,
  assetFs: AssetFsStore,
  sha256: string,
  ctx: GcScanContext,
  options: AssetGcCycleOptions & { now: string },
): "quarantined" | "skipped" {
  const fence = options.lock?.fence();
  const begin = assetRepo.beginAssetQuarantine(
    sha256,
    options.now,
    ctx.documentShas,
    (db, sha, nowIso) =>
      isSha256ReferencedLive(db, options.snapshotStore, sha, nowIso),
    fence,
  );
  if (begin === "skipped") {
    return "skipped";
  }
  options.lock?.renewOrAbort();
  const move = assetFs.moveLiveToQuarantine(sha256);
  options.lock?.renewOrAbort();
  assetRepo.finishAssetQuarantineAfterRename(
    sha256,
    move,
    options.now,
    fence,
  );
  return move.moved ? "quarantined" : "skipped";
}

export function runAssetGcCycle(
  assetRepo: AssetRepository,
  assetFs: AssetFsStore,
  ctx: GcScanContext,
  now: string = new Date().toISOString(),
  options: AssetGcCycleOptions,
): AssetGcRunResult {
  const result: AssetGcRunResult = {
    quarantined: 0,
    skipped: 0,
    deleted: 0,
  };
  const fence = options.lock?.fence();

  for (const sha256 of assetRepo.listGcCandidateShas(now, ctx.documentShas)) {
    options.lock?.renewOrAbort();
    const outcome = quarantineUnreferencedAsset(
      assetRepo,
      assetFs,
      sha256,
      ctx,
      { ...options, now },
    );
    if (outcome === "quarantined") {
      result.quarantined += 1;
    } else {
      result.skipped += 1;
    }
  }

  for (const sha256 of assetRepo.listQuarantinedReadyForDeletion(now)) {
    options.lock?.renewOrAbort();
    if (!assetFs.quarantineExists(sha256)) {
      if (assetRepo.deleteAssetObjectRow(sha256, fence)) {
        result.deleted += 1;
      }
      continue;
    }
    if (assetRepo.deleteAssetObjectRow(sha256, fence)) {
      options.lock?.renewOrAbort();
      if (assetFs.deleteQuarantined(sha256)) {
        result.deleted += 1;
      }
    }
  }

  return result;
}

export interface ReconcileGcResult {
  quarantiningRecovered: number;
  quarantinedRelocated: number;
  quarantinedRowsDeleted: number;
  orphanQuarantineRowsAdopted: number;
}

export function reconcileAssetGcState(
  assetRepo: AssetRepository,
  assetFs: AssetFsStore,
  ctx: GcScanContext,
  now: string = new Date().toISOString(),
  lock?: AssetGcLockHandle,
): ReconcileGcResult {
  const result: ReconcileGcResult = {
    quarantiningRecovered: 0,
    quarantinedRelocated: 0,
    quarantinedRowsDeleted: 0,
    orphanQuarantineRowsAdopted: 0,
  };
  const fence = lock?.fence();

  for (const sha256 of assetRepo.listQuarantiningShas()) {
    lock?.renewOrAbort();
    const outcome = assetRepo.reconcileQuarantiningRow({
      sha256,
      readFsState: () => ({
        liveExists: assetFs.liveExists(sha256),
        quarantineExists: assetFs.quarantineExists(sha256),
      }),
      now,
      snapshotDocumentShas: ctx.documentShas,
      snapshotOrganizationIds: organizationIdsForSha(ctx, sha256),
      fence,
    });

    lock?.renewOrAbort();
    const liveExists = assetFs.liveExists(sha256);
    const quarantineExists = assetFs.quarantineExists(sha256);
    if (outcome === "restored-live") {
      if (quarantineExists) {
        assetFs.deleteQuarantined(sha256);
      }
    } else if (outcome === "kept-quarantining") {
      if (liveExists && !quarantineExists) {
        lock?.renewOrAbort();
        const move = assetFs.moveLiveToQuarantine(sha256);
        lock?.renewOrAbort();
        assetRepo.finishAssetQuarantineAfterRename(sha256, move, now, fence);
      } else if (!liveExists && quarantineExists) {
        assetRepo.finishAssetQuarantineAfterRename(
          sha256,
          {
            moved: false,
            liveHadFile: false,
            quarantineHadFile: true,
          },
          now,
          fence,
        );
      }
    } else if (outcome === "marked-quarantined") {
      if (liveExists && quarantineExists) {
        assetFs.deleteLive(sha256);
      }
    }
    result.quarantiningRecovered += 1;
  }

  for (const sha256 of assetRepo.listQuarantinedShas()) {
    lock?.renewOrAbort();
    const liveExists = assetFs.liveExists(sha256);
    const quarantineExists = assetFs.quarantineExists(sha256);
    if (liveExists && !quarantineExists) {
      lock?.renewOrAbort();
      const move = assetFs.moveLiveToQuarantine(sha256);
      if (move.moved) {
        result.quarantinedRelocated += 1;
      }
      continue;
    }
    if (
      assetRepo.reconcileQuarantinedRow({
        sha256,
        readFsState: () => ({
          liveExists: assetFs.liveExists(sha256),
          quarantineExists: assetFs.quarantineExists(sha256),
        }),
        fence,
      }) === "deleted"
    ) {
      result.quarantinedRowsDeleted += 1;
    }
  }

  const dbRows = new Set([
    ...assetRepo.listQuarantinedShas(),
    ...assetRepo.listQuarantiningShas(),
  ]);
  for (const sha256 of assetFs.listQuarantinedAssetShas()) {
    if (dbRows.has(sha256)) continue;
    lock?.renewOrAbort();
    const bytes = assetFs.getQuarantined(sha256);
    if (!bytes) continue;
    const md5Hex = createHash("md5").update(bytes).digest("hex");
    if (
      assetRepo.insertQuarantinedOrphan(
        {
          sha256,
          byteLength: bytes.length,
          md5Hex,
          dataFormat: "png",
          now,
        },
        fence,
      )
    ) {
      result.orphanQuarantineRowsAdopted += 1;
    }
  }

  return result;
}

export function quarantineOrphanLiveAssets(
  assetRepo: AssetRepository,
  assetFs: AssetFsStore,
  now: string,
  lock?: AssetGcLockHandle,
): number {
  let quarantined = 0;
  const fence = lock?.fence();
  for (const sha256 of assetFs.listLiveAssetShas()) {
    lock?.renewOrAbort();
    if (assetRepo.hasAssetObjectRow(sha256)) continue;
    const bytes = assetFs.getLive(sha256);
    if (!bytes) continue;
    const md5Hex = createHash("md5").update(bytes).digest("hex");
    if (
      !assetRepo.beginOrphanQuarantine(
        {
          sha256,
          byteLength: bytes.length,
          md5Hex,
          dataFormat: "png",
          now,
        },
        fence,
      )
    ) {
      continue;
    }
    lock?.renewOrAbort();
    let move;
    try {
      move = assetFs.moveLiveToQuarantine(sha256);
    } catch {
      continue;
    }
    lock?.renewOrAbort();
    assetRepo.finishAssetQuarantineAfterRename(sha256, move, now, fence);
    if (move.moved || move.quarantineHadFile) {
      quarantined += 1;
    }
  }
  return quarantined;
}

export type GcLockOutcome = "ran" | "skipped";

export interface PersistBootGcOptions {
  clock?: () => Date;
}

export interface PersistBootGcResult {
  scanFailed: boolean;
  gcLock: GcLockOutcome;
  gc: ReconcileGcResult | null;
  orphanLiveQuarantined: number;
  gcCycle: AssetGcRunResult | null;
  lockLost: boolean;
}

export function runPersistBootGc(
  assetRepo: AssetRepository & AssetGcLockRepository,
  assetFs: AssetFsStore,
  ctx: GcScanContext,
  snapshotStore: SnapshotStore,
  now: string,
  options: PersistBootGcOptions = {},
): PersistBootGcResult {
  const clock = options.clock ?? (() => new Date());
  const owner = randomGcLockOwner();
  let gc: ReconcileGcResult | null = null;
  let orphanLiveQuarantined = 0;
  let gcCycle: AssetGcRunResult | null = null;
  let lockLost = false;
  const gcLock = withAssetGcLock(
    assetRepo,
    owner,
    clock().toISOString(),
    (handle) => {
      try {
        handle.renewOrAbort();
        gc = reconcileAssetGcState(assetRepo, assetFs, ctx, now, handle);
        handle.renewOrAbort();
        orphanLiveQuarantined = quarantineOrphanLiveAssets(
          assetRepo,
          assetFs,
          now,
          handle,
        );
        handle.renewOrAbort();
        gcCycle = runAssetGcCycle(assetRepo, assetFs, ctx, now, {
          snapshotStore,
          lock: { ...handle, ...assetRepo },
        });
      } catch (err) {
        if (err instanceof AssetGcLockLostError) {
          lockLost = true;
          return;
        }
        throw err;
      }
    },
    clock,
  );
  return {
    scanFailed: false,
    gcLock,
    gc,
    orphanLiveQuarantined,
    gcCycle,
    lockLost,
  };
}

/** @internal test helper */
export function randomGcLockOwner(): string {
  return `${process.pid}-${randomBytes(4).toString("hex")}`;
}

export { collectLiveReferencedShas, isSha256ReferencedLive };
