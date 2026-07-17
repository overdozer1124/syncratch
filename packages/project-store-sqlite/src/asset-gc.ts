import type Database from "better-sqlite3";
import type { MoveToQuarantineResult } from "@blocksync/project-assets-fs";
import { QUARANTINE_GRACE_MS } from "./constants.js";
import {
  collectReferencedShas,
  isShaReferenced,
  listOrganizationsReferencingSha,
} from "./gc-reference.js";
import {
  assertAssetGcLockFenceInDb,
  type AssetGcLockFence,
} from "./asset-gc-lock.js";
import { withImmediateTransaction } from "./immediate-transaction.js";

export type BeginAssetQuarantineResult = "started" | "skipped";

export type ReconcileQuarantiningResult =
  | "restored-live"
  | "kept-quarantining"
  | "marked-quarantined"
  | "deleted"
  | "noop";

export type { AssetGcLockFence };

export type IsReferencedLive = (
  db: Database.Database,
  sha256: string,
  now: string,
) => boolean;

export interface AssetGcRepository {
  listGcCandidateShas(
    now: string,
    snapshotDocumentShas: Iterable<string>,
  ): string[];

  beginAssetQuarantine(
    sha256: string,
    now: string,
    snapshotDocumentShas: Iterable<string>,
    isReferencedLive?: IsReferencedLive,
    fence?: AssetGcLockFence,
  ): BeginAssetQuarantineResult;

  finishAssetQuarantineAfterRename(
    sha256: string,
    move: MoveToQuarantineResult,
    now: string,
    fence?: AssetGcLockFence,
  ): void;

  listQuarantiningShas(): string[];

  listQuarantinedShas(): string[];

  reconcileQuarantiningRow(args: {
    sha256: string;
    readFsState: () => { liveExists: boolean; quarantineExists: boolean };
    now: string;
    snapshotDocumentShas: Iterable<string>;
    snapshotOrganizationIds: Iterable<string>;
    fence?: AssetGcLockFence;
  }): ReconcileQuarantiningResult;

  reconcileQuarantinedRow(args: {
    sha256: string;
    readFsState: () => { liveExists: boolean; quarantineExists: boolean };
    fence?: AssetGcLockFence;
  }): "deleted" | "unchanged";

  listQuarantinedReadyForDeletion(now: string): string[];

  deleteAssetObjectRow(sha256: string, fence?: AssetGcLockFence): boolean;

  insertQuarantinedOrphan(
    args: {
      sha256: string;
      byteLength: number;
      md5Hex: string;
      dataFormat: string;
      now: string;
    },
    fence?: AssetGcLockFence,
  ): boolean;

  beginOrphanQuarantine(
    args: {
      sha256: string;
      byteLength: number;
      md5Hex: string;
      dataFormat: string;
      now: string;
    },
    fence?: AssetGcLockFence,
  ): boolean;

  hasAssetObjectRow(sha256: string): boolean;

  restoreGrantsForReferencedOrganizations(
    sha256: string,
    now: string,
    snapshotDocumentShas: Iterable<string>,
    snapshotOrganizationIds: Iterable<string>,
  ): void;
}

export function createAssetGcRepository(
  db: Database.Database,
): AssetGcRepository {
  const stmts = {
    listLiveShas: db.prepare(`
      SELECT sha256 FROM asset_objects WHERE gc_state = 'live'
    `),
    getGcState: db.prepare(`
      SELECT gc_state AS gcState FROM asset_objects WHERE sha256 = ?
    `),
    hasAssetObjectRow: db.prepare(`
      SELECT 1 AS ok FROM asset_objects WHERE sha256 = ?
    `),
    markQuarantining: db.prepare(`
      UPDATE asset_objects
      SET gc_state = 'quarantining'
      WHERE sha256 = ? AND gc_state = 'live'
    `),
    markQuarantined: db.prepare(`
      UPDATE asset_objects
      SET gc_state = 'quarantined', quarantine_started_at = @now
      WHERE sha256 = @sha256 AND gc_state = 'quarantining'
    `),
    markLiveFromQuarantining: db.prepare(`
      UPDATE asset_objects
      SET gc_state = 'live', quarantine_started_at = NULL
      WHERE sha256 = ? AND gc_state = 'quarantining'
    `),
    deleteGrantsForSha: db.prepare(`
      DELETE FROM organization_asset_grants WHERE sha256 = ?
    `),
    insertGrant: db.prepare(`
      INSERT OR IGNORE INTO organization_asset_grants (
        organization_id, sha256, granted_at
      ) VALUES (@organizationId, @sha256, @grantedAt)
    `),
    listQuarantining: db.prepare(`
      SELECT sha256 FROM asset_objects WHERE gc_state = 'quarantining'
    `),
    listQuarantinedPastGrace: db.prepare(`
      SELECT sha256 FROM asset_objects
      WHERE gc_state = 'quarantined'
        AND quarantine_started_at IS NOT NULL
        AND quarantine_started_at <= ?
    `),
    deleteAssetObject: db.prepare(`
      DELETE FROM asset_objects WHERE sha256 = ?
    `),
    insertQuarantinedOrphan: db.prepare(`
      INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state,
        quarantine_started_at, created_at
      ) VALUES (
        @sha256, @byteLength, @md5Hex, @dataFormat, 'quarantined',
        @now, @now
      )
    `),
    insertOrphanQuarantining: db.prepare(`
      INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (
        @sha256, @byteLength, @md5Hex, @dataFormat, 'quarantining', @now
      )
    `),
  };

  return {
    listGcCandidateShas(now, snapshotDocumentShas) {
      const referenced = collectReferencedShas(db, now, snapshotDocumentShas);
      const rows = stmts.listLiveShas.all() as Array<{ sha256: string }>;
      return rows
        .map((row) => row.sha256)
        .filter((sha256) => !referenced.has(sha256));
    },

    beginAssetQuarantine(sha256, now, snapshotDocumentShas, isReferencedLive, fence) {
      return withImmediateTransaction(db, () => {
        if (fence) {
          assertAssetGcLockFenceInDb(
            db,
            fence.owner,
            fence.generation,
            fence.clock().toISOString(),
          );
        }
        const referenced = isReferencedLive
          ? isReferencedLive(db, sha256, now)
          : isShaReferenced(db, sha256, now, snapshotDocumentShas);
        if (referenced) {
          return "skipped";
        }
        const changed = stmts.markQuarantining.run(sha256).changes;
        if (changed === 0) {
          return "skipped";
        }
        stmts.deleteGrantsForSha.run(sha256);
        return "started";
      });
    },

    finishAssetQuarantineAfterRename(sha256, move, now, fence) {
      withImmediateTransaction(db, () => {
        if (fence) {
          assertAssetGcLockFenceInDb(
            db,
            fence.owner,
            fence.generation,
            fence.clock().toISOString(),
          );
        }
        const row = stmts.getGcState.get(sha256) as
          | { gcState: string }
          | undefined;
        if (!row || row.gcState !== "quarantining") {
          return;
        }
        if (move.moved) {
          stmts.markQuarantined.run({ now, sha256 });
          return;
        }
        if (move.liveHadFile) {
          stmts.markLiveFromQuarantining.run(sha256);
          return;
        }
        if (move.quarantineHadFile) {
          stmts.markQuarantined.run({ now, sha256 });
        }
      });
    },

    listQuarantiningShas() {
      const rows = stmts.listQuarantining.all() as Array<{ sha256: string }>;
      return rows.map((row) => row.sha256);
    },

    listQuarantinedShas() {
      const rows = db
        .prepare(`SELECT sha256 FROM asset_objects WHERE gc_state = 'quarantined'`)
        .all() as Array<{ sha256: string }>;
      return rows.map((row) => row.sha256);
    },

    reconcileQuarantiningRow(args) {
      const {
        sha256,
        readFsState,
        now,
        snapshotDocumentShas,
        snapshotOrganizationIds,
        fence,
      } = args;
      return withImmediateTransaction(db, () => {
        if (fence) {
          assertAssetGcLockFenceInDb(
            db,
            fence.owner,
            fence.generation,
            fence.clock().toISOString(),
          );
        }
        const { liveExists, quarantineExists } = readFsState();
        const row = stmts.getGcState.get(sha256) as
          | { gcState: string }
          | undefined;
        if (!row || row.gcState !== "quarantining") {
          return "noop";
        }
        if (!liveExists && quarantineExists) {
          stmts.markQuarantined.run({ now, sha256 });
          return "marked-quarantined";
        }
        if (!liveExists && !quarantineExists) {
          if (isShaReferenced(db, sha256, now, snapshotDocumentShas)) {
            return "kept-quarantining";
          }
          stmts.deleteAssetObject.run(sha256);
          return "deleted";
        }
        if (liveExists && quarantineExists) {
          if (!isShaReferenced(db, sha256, now, snapshotDocumentShas)) {
            stmts.markQuarantined.run({ now, sha256 });
            return "marked-quarantined";
          }
          stmts.markLiveFromQuarantining.run(sha256);
          const orgs = listOrganizationsReferencingSha(
            db,
            sha256,
            now,
            snapshotOrganizationIds,
          );
          for (const organizationId of orgs) {
            stmts.insertGrant.run({
              organizationId,
              sha256,
              grantedAt: now,
            });
          }
          return "restored-live";
        }
        if (liveExists) {
          if (!isShaReferenced(db, sha256, now, snapshotDocumentShas)) {
            return "kept-quarantining";
          }
          stmts.markLiveFromQuarantining.run(sha256);
          const orgs = listOrganizationsReferencingSha(
            db,
            sha256,
            now,
            snapshotOrganizationIds,
          );
          for (const organizationId of orgs) {
            stmts.insertGrant.run({
              organizationId,
              sha256,
              grantedAt: now,
            });
          }
          return "restored-live";
        }
        return "noop";
      });
    },

    reconcileQuarantinedRow(args) {
      const { sha256, readFsState, fence } = args;
      return withImmediateTransaction(db, () => {
        if (fence) {
          assertAssetGcLockFenceInDb(
            db,
            fence.owner,
            fence.generation,
            fence.clock().toISOString(),
          );
        }
        const { liveExists, quarantineExists } = readFsState();
        const row = stmts.getGcState.get(sha256) as
          | { gcState: string }
          | undefined;
        if (!row || row.gcState !== "quarantined") {
          return "unchanged";
        }
        if (!liveExists && !quarantineExists) {
          stmts.deleteAssetObject.run(sha256);
          return "deleted";
        }
        return "unchanged";
      });
    },

    listQuarantinedReadyForDeletion(now) {
      const cutoff = new Date(Date.parse(now) - QUARANTINE_GRACE_MS).toISOString();
      const rows = stmts.listQuarantinedPastGrace.all(cutoff) as Array<{
        sha256: string;
      }>;
      return rows.map((row) => row.sha256);
    },

    deleteAssetObjectRow(sha256, fence) {
      return withImmediateTransaction(db, () => {
        if (fence) {
          assertAssetGcLockFenceInDb(
            db,
            fence.owner,
            fence.generation,
            fence.clock().toISOString(),
          );
        }
        return stmts.deleteAssetObject.run(sha256).changes > 0;
      });
    },

    insertQuarantinedOrphan(args, fence) {
      return withImmediateTransaction(db, () => {
        if (fence) {
          assertAssetGcLockFenceInDb(
            db,
            fence.owner,
            fence.generation,
            fence.clock().toISOString(),
          );
        }
        try {
          return stmts.insertQuarantinedOrphan.run(args).changes > 0;
        } catch {
          return false;
        }
      });
    },

    beginOrphanQuarantine(args, fence) {
      return withImmediateTransaction(db, () => {
        if (fence) {
          assertAssetGcLockFenceInDb(
            db,
            fence.owner,
            fence.generation,
            fence.clock().toISOString(),
          );
        }
        try {
          return stmts.insertOrphanQuarantining.run(args).changes > 0;
        } catch {
          return false;
        }
      });
    },

    hasAssetObjectRow(sha256) {
      const row = stmts.hasAssetObjectRow.get(sha256) as
        | { ok: number }
        | undefined;
      return row !== undefined;
    },

    restoreGrantsForReferencedOrganizations(
      sha256,
      now,
      _snapshotDocumentShas,
      snapshotOrganizationIds,
    ) {
      const orgs = listOrganizationsReferencingSha(
        db,
        sha256,
        now,
        snapshotOrganizationIds,
      );
      withImmediateTransaction(db, () => {
        for (const organizationId of orgs) {
          stmts.insertGrant.run({
            organizationId,
            sha256,
            grantedAt: now,
          });
        }
      });
    },
  };
}
