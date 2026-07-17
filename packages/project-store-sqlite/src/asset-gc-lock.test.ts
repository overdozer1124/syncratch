import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSqliteAssetRepository,
  migrate,
  migrateAssets,
  migrateAuth,
  AssetGcLockLostError,
  createAssetGcLockHandle,
  GC_LOCK_LEASE_MS,
  seedActiveAssetGcLock,
  seedStaleAssetGcLock,
  withAssetGcLock,
} from "./index.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "asset-gc-lock-"));
  dirs.push(dir);
  const db = new Database(join(dir, "test.sqlite"));
  migrate(db);
  migrateAuth(db);
  migrateAssets(db);
  return { db, dir };
}

describe("asset gc sqlite lock", () => {
  it("allows stale takeover and releases only matching owner", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    seedStaleAssetGcLock(db, "dead-worker", now);

    expect(withAssetGcLock(repo, "live-worker", now, () => {})).toBe("ran");
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM asset_gc_lock`).get(),
    ).toEqual({ c: 0 });

    seedActiveAssetGcLock(db, "active-worker", now);
    expect(withAssetGcLock(repo, "other-worker", now, () => {})).toBe("skipped");
    expect(
      (
        db.prepare(`SELECT owner FROM asset_gc_lock WHERE id = 1`).get() as {
          owner: string;
        }
      ).owner,
    ).toBe("active-worker");
    db.close();
  });

  it("renews active lease for long-running holder", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const acquired = repo.tryAcquireAssetGcLock("worker-1", now);
    expect(acquired.outcome).toBe("acquired");
    if (acquired.outcome === "skipped") return;
    const before = (
      db.prepare(`SELECT expires_at AS expiresAt FROM asset_gc_lock WHERE id = 1`).get() as {
        expiresAt: string;
      }
    ).expiresAt;
    const later = new Date(Date.parse(now) + 60_000).toISOString();
    expect(repo.renewAssetGcLock("worker-1", acquired.generation, later)).toBe(
      true,
    );
    const after = (
      db.prepare(`SELECT expires_at AS expiresAt FROM asset_gc_lock WHERE id = 1`).get() as {
        expiresAt: string;
      }
    ).expiresAt;
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
    repo.releaseAssetGcLock("worker-1", acquired.generation);
    db.close();
  });

  it("assertAssetGcLockHeld rejects stale owner after takeover", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const acquiredA = repo.tryAcquireAssetGcLock("worker-a", now);
    expect(acquiredA.outcome).toBe("acquired");
    if (acquiredA.outcome === "skipped") return;
    const expiredAt = new Date(Date.parse(now) - 1_000).toISOString();
    db.prepare(`UPDATE asset_gc_lock SET expires_at = ? WHERE id = 1`).run(
      expiredAt,
    );
    const acquiredB = repo.tryAcquireAssetGcLock("worker-b", now);
    expect(acquiredB.outcome).toBe("acquired");
    if (acquiredB.outcome === "skipped") return;
    expect(() =>
      repo.assertAssetGcLockHeld("worker-a", acquiredA.generation, now),
    ).toThrow(AssetGcLockLostError);
    repo.releaseAssetGcLock("worker-b", acquiredB.generation);
    db.close();
  });

  it("renews lease from injected clock time not boot cutoff", () => {
    const { db } = tempDb();
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const clock = () => new Date(nowMs);
    const repo = createSqliteAssetRepository(db);
    const bootNow = clock().toISOString();
    const acquired = repo.tryAcquireAssetGcLock("worker-1", bootNow);
    expect(acquired.outcome).toBe("acquired");
    if (acquired.outcome === "skipped") return;
    const handle = createAssetGcLockHandle(
      repo,
      "worker-1",
      acquired.generation,
      clock,
    );

    nowMs += GC_LOCK_LEASE_MS + 60_000;
    handle.renewOrAbort();
    const expiresAt = (
      db.prepare(`SELECT expires_at AS expiresAt FROM asset_gc_lock WHERE id = 1`).get() as {
        expiresAt: string;
      }
    ).expiresAt;
    expect(Date.parse(expiresAt)).toBe(nowMs + GC_LOCK_LEASE_MS);

    nowMs += GC_LOCK_LEASE_MS + 1;
    expect(() =>
      repo.assertAssetGcLockHeld(
        "worker-1",
        acquired.generation,
        clock().toISOString(),
      ),
    ).toThrow(AssetGcLockLostError);

    repo.releaseAssetGcLock("worker-1", acquired.generation);
    db.close();
  });

  it("increments generation on stale takeover", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    seedStaleAssetGcLock(db, "dead-worker", now, 3);
    const acquired = repo.tryAcquireAssetGcLock("live-worker", now);
    expect(acquired.outcome).toBe("acquired");
    if (acquired.outcome === "skipped") return;
    expect(acquired.generation).toBe(4);
    repo.releaseAssetGcLock("live-worker", acquired.generation);
    db.close();
  });
});
