/**
 * @experimental R1 SQLite project + auth + asset store.
 */

export { openSqliteStore } from "./store.js";
export type { SqliteStore, SqliteStoreOptions } from "./store.js";
export { migrate } from "./migrate.js";
export { migrateAuth } from "./migrate-auth.js";
export { migrateAssets } from "./migrate-assets.js";
export {runSchemaMigrations} from "./migrations/index.js";
export {
  SchemaMigrationError,
  type SchemaMigration,
  type SchemaMigrationErrorCode,
} from "./migrations/types.js";
export {
  AssetMetadataMismatchError,
  AssetNotLiveError,
  createSqliteAssetRepository,
  GlobalDiskExceededError,
  ImportPreconditionError,
  OrgQuotaExceededError,
  ReservationCapacityExceededError,
  ReservationNotFoundError,
  StaleFileBytesError,
} from "./asset-repository.js";
export type {
  AssetObjectInput,
  AssetRepository,
  ImportLeaseInput,
  ImportSb3CreateProjectInput,
} from "./asset-repository.js";
export {
  GLOBAL_DISK_BYTES,
  IMPORT_SPOOL_CAP_BYTES,
  IMPORT_HOLDING_BUDGET_BYTES,
  INITIAL_GLOBAL_RESERVATION_BYTES,
  ORG_QUOTA_BYTES,
  QUARANTINE_GRACE_MS,
  GC_LOCK_LEASE_MS,
  RESERVATION_TTL_MS,
} from "./constants.js";
export {
  createAssetGcLockRepository,
  AssetGcLockLostError,
  createAssetGcLockHandle,
  createAssetGcLockSession,
  seedActiveAssetGcLock,
  seedStaleAssetGcLock,
  withAssetGcLock,
  type AssetGcLockAcquireResult,
  type AssetGcLockFence,
  type AssetGcLockHandle,
  type AssetGcLockOutcome,
  type AssetGcLockRepository,
  type AssetGcLockSession,
} from "./asset-gc-lock.js";
export { collectReferencedShas, isShaReferenced } from "./gc-reference.js";
export { collectDocumentShas, computeGlobalUsedBytes, computeOrgQuotaBytes } from "./quota.js";
export { withImmediateTransaction } from "./immediate-transaction.js";
export { createSqliteCommitAssetGuard } from "./commit-asset-guard.js";
export { createSqliteLiveAssetCatalog } from "./live-asset-catalog.js";
