import Database from "better-sqlite3";
import type { SnapshotStore } from "@blocksync/project-service";
import type { AssetFsStore } from "@blocksync/project-assets-fs";
import type { AssetRepository } from "@blocksync/project-store-sqlite";
import {
  buildGcScanContext,
  GcScanFailedError,
  runPersistBootGc,
} from "./gc.js";

export function reconcileExpiredReservations(
  assetRepo: AssetRepository,
  now: () => Date = () => new Date(),
): { global: number; orgQuota: number; leases: number } {
  return assetRepo.deleteExpiredReservations(now().toISOString());
}

export interface BootReconcileOptions {
  assetRepo: AssetRepository;
  assetFs: AssetFsStore;
  dbPath: string;
  snapshotStore: SnapshotStore;
  now?: () => Date;
}

export function reconcilePersistBoot(options: BootReconcileOptions): {
  reservations: { global: number; orgQuota: number; leases: number };
  gc: ReturnType<typeof runPersistBootGc>["gc"];
  orphanLiveQuarantined: number;
  gcScanFailed: boolean;
  gcCycle: ReturnType<typeof runPersistBootGc>["gcCycle"];
  gcLock: ReturnType<typeof runPersistBootGc>["gcLock"];
} {
  const now = options.now ?? (() => new Date());
  const nowIso = now().toISOString();
  const reservations = reconcileExpiredReservations(options.assetRepo, now);

  const db = new Database(options.dbPath, { readonly: true });
  let ctx;
  try {
    ctx = buildGcScanContext(db, options.snapshotStore);
  } catch (err) {
    db.close();
    if (err instanceof GcScanFailedError) {
      return {
        reservations,
        gc: null,
        orphanLiveQuarantined: 0,
        gcScanFailed: true,
        gcCycle: null,
        gcLock: "skipped",
      };
    }
    throw err;
  }

  try {
    const bootGc = runPersistBootGc(
      options.assetRepo,
      options.assetFs,
      ctx,
      options.snapshotStore,
      nowIso,
    );
    return {
      reservations,
      gc: bootGc.gc,
      orphanLiveQuarantined: bootGc.orphanLiveQuarantined,
      gcScanFailed: false,
      gcCycle: bootGc.gcCycle,
      gcLock: bootGc.gcLock,
    };
  } finally {
    db.close();
  }
}

export { GcScanFailedError };
