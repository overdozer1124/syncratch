import type { ProjectEnvelopeV1 } from "@blocksync/project-envelope";
import type Database from "better-sqlite3";
import {
  GLOBAL_DISK_BYTES,
  ORG_QUOTA_BYTES,
  RESERVATION_TTL_MS,
  type AssetDataFormat,
} from "./constants.js";
import { withImmediateTransaction } from "./immediate-transaction.js";
import {
  computeGlobalUsedBytes,
  computeOrgQuotaBytes,
  type ShaByteLength,
} from "./quota.js";

export class OrgQuotaExceededError extends Error {
  constructor() {
    super("ORG_QUOTA_EXCEEDED");
    this.name = "OrgQuotaExceededError";
  }
}

export class GlobalDiskExceededError extends Error {
  constructor() {
    super("GLOBAL_DISK_EXCEEDED");
    this.name = "GlobalDiskExceededError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor(importSessionId: string) {
    super(`RESERVATION_NOT_FOUND:${importSessionId}`);
    this.name = "ReservationNotFoundError";
  }
}

export interface AssetObjectInput {
  sha256: string;
  byteLength: number;
  md5Hex: string;
  dataFormat: AssetDataFormat;
}

export interface ImportLeaseInput {
  leaseId: string;
  sha256: string;
}

export interface ImportSb3CreateProjectInput {
  organizationId: string;
  ownerUserId: string;
  projectId: string;
  title: string;
  envelope: ProjectEnvelopeV1;
  assetObjects: AssetObjectInput[];
  grantShas: string[];
  releaseImportSessionId: string;
  /** Injectable on-disk byte count for global guard (§4.6.2). */
  fileBytes: number;
  /** CAS bytes from this import not yet included in fileBytes. */
  newCasBytes?: number;
  now?: string;
}

export interface AssetRepository {
  createGlobalDiskReservation(args: {
    reservationId: string;
    importSessionId: string;
    reservedBytes: number;
    fileBytes: number;
    now?: string;
  }): void;

  materializeGlobalDiskReservation(args: {
    importSessionId: string;
    deltaBytes: number;
  }): void;

  releaseGlobalDiskReservation(importSessionId: string): void;

  createImportLeases(args: {
    organizationId: string;
    importSessionId: string;
    leases: ImportLeaseInput[];
    now?: string;
  }): void;

  createQuotaReservation(args: {
    reservationId: string;
    organizationId: string;
    importSessionId: string;
    shas: ShaByteLength[];
    now?: string;
  }): void;

  importSb3CreateProjectAtomic(input: ImportSb3CreateProjectInput): ProjectEnvelopeV1;

  deleteExpiredReservations(now: string): {
    global: number;
    orgQuota: number;
    leases: number;
  };

  computeOrgQuotaBytes(
    organizationId: string,
    now: string,
    pendingShas?: Iterable<ShaByteLength>,
  ): number;

  computeGlobalUsedBytes(
    fileBytes: number,
    now: string,
    excludeImportSessionId?: string,
  ): number;
}

function reservationExpiresAt(now: string): string {
  const ms = Date.parse(now) + RESERVATION_TTL_MS;
  return new Date(ms).toISOString();
}

export function createSqliteAssetRepository(
  db: Database.Database,
): AssetRepository {
  const stmts = {
    insertGlobalReservation: db.prepare(`
      INSERT INTO global_disk_reservations (
        reservation_id, import_session_id, reserved_bytes, materialized_bytes,
        expires_at, created_at
      ) VALUES (
        @reservationId, @importSessionId, @reservedBytes, 0,
        @expiresAt, @createdAt
      )
    `),
    materializeGlobal: db.prepare(`
      UPDATE global_disk_reservations
      SET materialized_bytes = materialized_bytes + @deltaBytes
      WHERE import_session_id = @importSessionId
    `),
    deleteGlobalReservation: db.prepare(`
      DELETE FROM global_disk_reservations WHERE import_session_id = ?
    `),
    insertLease: db.prepare(`
      INSERT INTO asset_import_leases (
        lease_id, organization_id, sha256, import_session_id, created_at, expires_at
      ) VALUES (
        @leaseId, @organizationId, @sha256, @importSessionId, @createdAt, @expiresAt
      )
    `),
    insertQuotaReservation: db.prepare(`
      INSERT INTO organization_asset_quota_reservations (
        reservation_id, organization_id, import_session_id, reserved_bytes,
        expires_at, created_at
      ) VALUES (
        @reservationId, @organizationId, @importSessionId, @reservedBytes,
        @expiresAt, @createdAt
      )
    `),
    insertQuotaSha: db.prepare(`
      INSERT INTO organization_asset_quota_reservation_shas (
        reservation_id, sha256, byte_length
      ) VALUES (@reservationId, @sha256, @byteLength)
    `),
    deleteQuotaReservation: db.prepare(`
      DELETE FROM organization_asset_quota_reservations
      WHERE import_session_id = ?
    `),
    deleteLeasesForSession: db.prepare(`
      DELETE FROM asset_import_leases WHERE import_session_id = ?
    `),
    insertAssetObject: db.prepare(`
      INSERT OR IGNORE INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (
        @sha256, @byteLength, @md5Hex, @dataFormat, 'live', @createdAt
      )
    `),
    insertGrant: db.prepare(`
      INSERT OR IGNORE INTO organization_asset_grants (
        organization_id, sha256, granted_at
      ) VALUES (@organizationId, @sha256, @grantedAt)
    `),
    insertProject: db.prepare(`
      INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES (
        @id, @organizationId, @ownerUserId, @title, @headRevision, @createdAt, @updatedAt
      )
    `),
    insertMember: db.prepare(`
      INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
    `),
    insertRevision: db.prepare(`
      INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at, client_transaction_id
      ) VALUES (
        @projectId, @revision, @envelopeJson, @contentHash, @requestHash,
        @actorUserId, @createdAt, @transactionId
      )
    `),
    deleteExpiredGlobal: db.prepare(`
      DELETE FROM global_disk_reservations WHERE expires_at <= ?
    `),
    deleteExpiredQuota: db.prepare(`
      DELETE FROM organization_asset_quota_reservations WHERE expires_at <= ?
    `),
    deleteExpiredLeases: db.prepare(`
      DELETE FROM asset_import_leases WHERE expires_at <= ?
    `),
  };

  return {
    createGlobalDiskReservation(args) {
      const now = args.now ?? new Date().toISOString();
      withImmediateTransaction(db, () => {
        const used = computeGlobalUsedBytes(db, args.fileBytes, now);
        if (used + args.reservedBytes > GLOBAL_DISK_BYTES) {
          throw new GlobalDiskExceededError();
        }
        stmts.insertGlobalReservation.run({
          reservationId: args.reservationId,
          importSessionId: args.importSessionId,
          reservedBytes: args.reservedBytes,
          expiresAt: reservationExpiresAt(now),
          createdAt: now,
        });
      });
    },

    materializeGlobalDiskReservation(args) {
      const info = stmts.materializeGlobal.run({
        importSessionId: args.importSessionId,
        deltaBytes: args.deltaBytes,
      });
      if (info.changes !== 1) {
        throw new ReservationNotFoundError(args.importSessionId);
      }
    },

    releaseGlobalDiskReservation(importSessionId) {
      stmts.deleteGlobalReservation.run(importSessionId);
    },

    createImportLeases(args) {
      const now = args.now ?? new Date().toISOString();
      const expiresAt = reservationExpiresAt(now);
      for (const lease of args.leases) {
        stmts.insertLease.run({
          leaseId: lease.leaseId,
          organizationId: args.organizationId,
          sha256: lease.sha256,
          importSessionId: args.importSessionId,
          createdAt: now,
          expiresAt,
        });
      }
    },

    createQuotaReservation(args) {
      const now = args.now ?? new Date().toISOString();
      const reservedBytes = args.shas.reduce((sum, s) => sum + s.byteLength, 0);
      withImmediateTransaction(db, () => {
        const used = computeOrgQuotaBytes(db, args.organizationId, now, args.shas);
        if (used > ORG_QUOTA_BYTES) {
          throw new OrgQuotaExceededError();
        }
        stmts.insertQuotaReservation.run({
          reservationId: args.reservationId,
          organizationId: args.organizationId,
          importSessionId: args.importSessionId,
          reservedBytes,
          expiresAt: reservationExpiresAt(now),
          createdAt: now,
        });
        for (const sha of args.shas) {
          stmts.insertQuotaSha.run({
            reservationId: args.reservationId,
            sha256: sha.sha256,
            byteLength: sha.byteLength,
          });
        }
      });
    },

    importSb3CreateProjectAtomic(input) {
      const now = input.now ?? new Date().toISOString();
      const newCasBytes = input.newCasBytes ?? 0;

      return withImmediateTransaction(db, () => {
        const pendingShas: ShaByteLength[] = input.assetObjects.map((o) => ({
          sha256: o.sha256,
          byteLength: o.byteLength,
        }));

        const orgUsed = computeOrgQuotaBytes(
          db,
          input.organizationId,
          now,
          pendingShas,
        );
        if (orgUsed > ORG_QUOTA_BYTES) {
          throw new OrgQuotaExceededError();
        }

        const globalUsed =
          computeGlobalUsedBytes(
            db,
            input.fileBytes,
            now,
            input.releaseImportSessionId,
          ) + newCasBytes;
        if (globalUsed > GLOBAL_DISK_BYTES) {
          throw new GlobalDiskExceededError();
        }

        for (const obj of input.assetObjects) {
          stmts.insertAssetObject.run({
            sha256: obj.sha256,
            byteLength: obj.byteLength,
            md5Hex: obj.md5Hex,
            dataFormat: obj.dataFormat,
            createdAt: now,
          });
        }

        for (const sha of input.grantShas) {
          stmts.insertGrant.run({
            organizationId: input.organizationId,
            sha256: sha,
            grantedAt: now,
          });
        }

        const createdAt = input.envelope.updatedAt;
        stmts.insertProject.run({
          id: input.projectId,
          organizationId: input.organizationId,
          ownerUserId: input.ownerUserId,
          title: input.title,
          headRevision: input.envelope.revision,
          createdAt,
          updatedAt: createdAt,
        });
        stmts.insertMember.run(input.projectId, input.ownerUserId, "owner");
        stmts.insertRevision.run({
          projectId: input.projectId,
          revision: input.envelope.revision,
          envelopeJson: JSON.stringify(input.envelope),
          contentHash: input.envelope.contentHash,
          requestHash: "",
          actorUserId: input.ownerUserId,
          createdAt,
          transactionId: null,
        });

        stmts.deleteLeasesForSession.run(input.releaseImportSessionId);
        stmts.deleteQuotaReservation.run(input.releaseImportSessionId);
        stmts.deleteGlobalReservation.run(input.releaseImportSessionId);

        return input.envelope;
      });
    },

    deleteExpiredReservations(now) {
      const global = stmts.deleteExpiredGlobal.run(now).changes;
      const orgQuota = stmts.deleteExpiredQuota.run(now).changes;
      const leases = stmts.deleteExpiredLeases.run(now).changes;
      return { global, orgQuota, leases };
    },

    computeOrgQuotaBytes(organizationId, now, pendingShas) {
      return computeOrgQuotaBytes(db, organizationId, now, pendingShas);
    },

    computeGlobalUsedBytes(fileBytes, now, excludeImportSessionId) {
      return computeGlobalUsedBytes(
        db,
        fileBytes,
        now,
        excludeImportSessionId,
      );
    },
  };
}
