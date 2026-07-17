import type Database from "better-sqlite3";
import { GC_LOCK_LEASE_MS } from "./constants.js";
import { withImmediateTransaction } from "./immediate-transaction.js";

export type AssetGcLockAcquireResult =
  | { outcome: "acquired"; generation: number }
  | { outcome: "skipped" };

export class AssetGcLockLostError extends Error {
  constructor(message = "Asset GC lock lost") {
    super(message);
    this.name = "AssetGcLockLostError";
  }
}

export interface AssetGcLockFence {
  owner: string;
  generation: number;
  clock: () => Date;
}

export interface AssetGcLockHandle {
  readonly owner: string;
  readonly generation: number;
  readonly clock: () => Date;
  renewOrAbort(): void;
  fence(): AssetGcLockFence;
}

export interface AssetGcLockRepository {
  tryAcquireAssetGcLock(
    owner: string,
    now: string,
  ): AssetGcLockAcquireResult;

  renewAssetGcLock(
    owner: string,
    generation: number,
    now: string,
  ): boolean;

  releaseAssetGcLock(owner: string, generation: number): boolean;

  assertAssetGcLockHeld(
    owner: string,
    generation: number,
    now: string,
  ): void;
}

export function assertAssetGcLockFenceInDb(
  db: Database.Database,
  owner: string,
  generation: number,
  now: string,
): void {
  const row = db
    .prepare(
      `SELECT owner, generation, expires_at AS expiresAt FROM asset_gc_lock WHERE id = 1`,
    )
    .get() as
    | { owner: string; generation: number; expiresAt: string }
    | undefined;
  const nowMs = Date.parse(now);
  if (
    !row ||
    row.owner !== owner ||
    row.generation !== generation ||
    Date.parse(row.expiresAt) <= nowMs
  ) {
    throw new AssetGcLockLostError(
      `Asset GC lock fence rejected for ${owner} gen ${generation}`,
    );
  }
}

export function createAssetGcLockHandle(
  lockRepo: AssetGcLockRepository,
  owner: string,
  generation: number,
  clock: () => Date = () => new Date(),
): AssetGcLockHandle {
  return {
    owner,
    generation,
    clock,
    renewOrAbort() {
      const now = clock().toISOString();
      if (!lockRepo.renewAssetGcLock(owner, generation, now)) {
        throw new AssetGcLockLostError(
          `Asset GC lock lost for owner ${owner} gen ${generation}`,
        );
      }
    },
    fence() {
      return { owner, generation, clock };
    },
  };
}

/** @deprecated Use createAssetGcLockHandle via withAssetGcLock callback */
export function createAssetGcLockSession(
  lockRepo: AssetGcLockRepository,
  owner: string,
  generation: number,
  clock: () => Date = () => new Date(),
): AssetGcLockHandle {
  return createAssetGcLockHandle(lockRepo, owner, generation, clock);
}

export type AssetGcLockSession = AssetGcLockHandle;

export function createAssetGcLockRepository(
  db: Database.Database,
): AssetGcLockRepository {
  const getLock = db.prepare(`
    SELECT owner, generation, expires_at AS expiresAt
    FROM asset_gc_lock
    WHERE id = 1
  `);
  const insertLock = db.prepare(`
    INSERT INTO asset_gc_lock (id, owner, generation, acquired_at, expires_at)
    VALUES (1, @owner, @generation, @now, @expiresAt)
  `);
  const takeoverStaleLock = db.prepare(`
    UPDATE asset_gc_lock
    SET owner = @owner,
        generation = generation + 1,
        acquired_at = @now,
        expires_at = @expiresAt
    WHERE id = 1 AND expires_at <= @now
  `);
  const renewLock = db.prepare(`
    UPDATE asset_gc_lock
    SET expires_at = @expiresAt
    WHERE id = 1 AND owner = @owner AND generation = @generation
  `);
  const releaseLock = db.prepare(`
    DELETE FROM asset_gc_lock
    WHERE id = 1 AND owner = @owner AND generation = @generation
  `);

  return {
    tryAcquireAssetGcLock(owner, now) {
      return withImmediateTransaction(db, () => {
        const nowMs = Date.parse(now);
        const expiresAt = new Date(nowMs + GC_LOCK_LEASE_MS).toISOString();
        const row = getLock.get() as
          | { owner: string; generation: number; expiresAt: string }
          | undefined;
        if (!row) {
          try {
            insertLock.run({ owner, generation: 1, now, expiresAt });
            return { outcome: "acquired" as const, generation: 1 };
          } catch {
            return { outcome: "skipped" as const };
          }
        }
        if (Date.parse(row.expiresAt) > nowMs) {
          return row.owner === owner
            ? { outcome: "acquired" as const, generation: row.generation }
            : { outcome: "skipped" as const };
        }
        if (takeoverStaleLock.run({ owner, now, expiresAt }).changes === 1) {
          const next = getLock.get() as { generation: number };
          return { outcome: "acquired" as const, generation: next.generation };
        }
        return { outcome: "skipped" as const };
      });
    },

    renewAssetGcLock(owner, generation, now) {
      return withImmediateTransaction(db, () => {
        const nowMs = Date.parse(now);
        const expiresAt = new Date(nowMs + GC_LOCK_LEASE_MS).toISOString();
        return renewLock.run({ owner, generation, expiresAt }).changes === 1;
      });
    },

    releaseAssetGcLock(owner, generation) {
      return withImmediateTransaction(db, () => {
        return releaseLock.run({ owner, generation }).changes > 0;
      });
    },

    assertAssetGcLockHeld(owner, generation, now) {
      assertAssetGcLockFenceInDb(db, owner, generation, now);
    },
  };
}

export type AssetGcLockOutcome = "ran" | "skipped";

export function withAssetGcLock(
  lockRepo: AssetGcLockRepository,
  owner: string,
  now: string,
  fn: (handle: AssetGcLockHandle) => void,
  clock: () => Date = () => new Date(),
): AssetGcLockOutcome {
  const acquired = lockRepo.tryAcquireAssetGcLock(owner, now);
  if (acquired.outcome === "skipped") {
    return "skipped";
  }
  const handle = createAssetGcLockHandle(
    lockRepo,
    owner,
    acquired.generation,
    clock,
  );
  try {
    fn(handle);
    return "ran";
  } finally {
    lockRepo.releaseAssetGcLock(owner, acquired.generation);
  }
}

/** Test helper: insert an expired lock row owned by another worker. */
export function seedStaleAssetGcLock(
  db: Database.Database,
  owner: string,
  now: string,
  generation = 1,
): void {
  const expiredAt = new Date(Date.parse(now) - 1_000).toISOString();
  db.prepare(`DELETE FROM asset_gc_lock WHERE id = 1`).run();
  db.prepare(`
    INSERT INTO asset_gc_lock (id, owner, generation, acquired_at, expires_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(owner, generation, expiredAt, expiredAt);
}

/** Test helper: insert an active lock row owned by another worker. */
export function seedActiveAssetGcLock(
  db: Database.Database,
  owner: string,
  now: string,
  generation = 1,
): void {
  const expiresAt = new Date(Date.parse(now) + GC_LOCK_LEASE_MS).toISOString();
  db.prepare(`DELETE FROM asset_gc_lock WHERE id = 1`).run();
  db.prepare(`
    INSERT INTO asset_gc_lock (id, owner, generation, acquired_at, expires_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(owner, generation, now, expiresAt);
}
