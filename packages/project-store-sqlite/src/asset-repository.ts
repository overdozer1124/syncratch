import type { ProjectEnvelopeV1 } from "@blocksync/project-envelope";
import type Database from "better-sqlite3";
import {
  createAssetGcRepository,
  type AssetGcRepository,
} from "./asset-gc.js";
import {
  createAssetGcLockRepository,
  type AssetGcLockRepository,
} from "./asset-gc-lock.js";
import {
  GLOBAL_DISK_BYTES,
  ORG_QUOTA_BYTES,
  RESERVATION_TTL_MS,
  type AssetDataFormat,
} from "./constants.js";
import { withImmediateTransaction } from "./immediate-transaction.js";
import {
  collectDocumentShas,
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

export class ReservationCapacityExceededError extends Error {
  constructor(importSessionId: string) {
    super(`RESERVATION_CAPACITY_EXCEEDED:${importSessionId}`);
    this.name = "ReservationCapacityExceededError";
  }
}

export class ImportPreconditionError extends Error {
  constructor(detail: string) {
    super(`IMPORT_PRECONDITION:${detail}`);
    this.name = "ImportPreconditionError";
  }
}

export class AssetNotLiveError extends Error {
  constructor(sha256: string) {
    super(`ASSET_NOT_LIVE:${sha256}`);
    this.name = "AssetNotLiveError";
  }
}

export class AssetMetadataMismatchError extends Error {
  constructor(sha256: string) {
    super(`ASSET_METADATA_MISMATCH:${sha256}`);
    this.name = "AssetMetadataMismatchError";
  }
}

export class StaleFileBytesError extends Error {
  constructor(fileBytes: number, materializedBytes: number) {
    super(`STALE_FILE_BYTES:${fileBytes}<${materializedBytes}`);
    this.name = "StaleFileBytesError";
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
  /**
   * Current total on-disk bytes under R1_DATA_DIR, measured after this
   * session's spool/holding/CAS materialization (§4.6.2).
   */
  fileBytes: number;
  now?: string;
}

export interface AssetRepository extends AssetGcRepository, AssetGcLockRepository {
  createGlobalDiskReservation(args: {
    reservationId: string;
    importSessionId: string;
    reservedBytes: number;
    /** Current total on-disk bytes under R1_DATA_DIR. */
    fileBytes: number;
    now?: string;
  }): void;

  extendGlobalDiskReservation(args: {
    importSessionId: string;
    additionalBytes: number;
    /** Current total on-disk bytes before the additional CAS write. */
    fileBytes: number;
    now?: string;
  }): void;

  materializeGlobalDiskReservation(args: {
    importSessionId: string;
    deltaBytes: number;
    now?: string;
  }): void;

  releaseGlobalDiskReservation(importSessionId: string): void;

  /** Release global + org quota + leases for a failed import session (Design §4.6.2). */
  releaseImportSession(args: {
    organizationId: string;
    importSessionId: string;
    now?: string;
  }): void;

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

function assertByteCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

export function createSqliteAssetRepository(
  db: Database.Database,
): AssetRepository {
  const gc = createAssetGcRepository(db);
  const gcLock = createAssetGcLockRepository(db);
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
    getActiveGlobalReservation: db.prepare(`
      SELECT reservation_id AS reservationId
      FROM global_disk_reservations
      WHERE import_session_id = ? AND expires_at > ?
    `),
    getActiveMaterializedBytes: db.prepare(`
      SELECT COALESCE(SUM(materialized_bytes), 0) AS materializedBytes
      FROM global_disk_reservations
      WHERE expires_at > ?
    `),
    extendGlobalReservation: db.prepare(`
      UPDATE global_disk_reservations
      SET reserved_bytes = reserved_bytes + @additionalBytes
      WHERE import_session_id = @importSessionId AND expires_at > @now
    `),
    materializeGlobal: db.prepare(`
      UPDATE global_disk_reservations
      SET materialized_bytes = materialized_bytes + @deltaBytes
      WHERE import_session_id = @importSessionId
        AND expires_at > @now
        AND materialized_bytes + @deltaBytes <= reserved_bytes
    `),
    deleteGlobalReservation: db.prepare(`
      DELETE FROM global_disk_reservations WHERE import_session_id = ?
    `),
    consumeGlobalReservation: db.prepare(`
      DELETE FROM global_disk_reservations
      WHERE import_session_id = @importSessionId AND expires_at > @now
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
    getActiveQuotaReservation: db.prepare(`
      SELECT
        reservation_id AS reservationId,
        reserved_bytes AS reservedBytes
      FROM organization_asset_quota_reservations
      WHERE import_session_id = ?
        AND organization_id = ?
        AND expires_at > ?
    `),
    getActiveQuotaShas: db.prepare(`
      SELECT s.sha256 AS sha256, s.byte_length AS byteLength
      FROM organization_asset_quota_reservation_shas s
      INNER JOIN organization_asset_quota_reservations r
        ON r.reservation_id = s.reservation_id
      WHERE r.import_session_id = ?
        AND r.organization_id = ?
        AND r.expires_at > ?
    `),
    getActiveLeases: db.prepare(`
      SELECT lease_id AS leaseId, sha256 AS sha256
      FROM asset_import_leases
      WHERE import_session_id = ?
        AND organization_id = ?
        AND expires_at > ?
    `),
    deleteQuotaReservation: db.prepare(`
      DELETE FROM organization_asset_quota_reservations
      WHERE import_session_id = @importSessionId
        AND organization_id = @organizationId
        AND expires_at > @now
    `),
    deleteQuotaReservationForSession: db.prepare(`
      DELETE FROM organization_asset_quota_reservations
      WHERE import_session_id = @importSessionId
        AND organization_id = @organizationId
    `),
    deleteLeasesForSession: db.prepare(`
      DELETE FROM asset_import_leases
      WHERE import_session_id = @importSessionId
        AND organization_id = @organizationId
        AND expires_at > @now
    `),
    deleteLeasesForSessionForce: db.prepare(`
      DELETE FROM asset_import_leases
      WHERE import_session_id = @importSessionId
        AND organization_id = @organizationId
    `),
    insertAssetObject: db.prepare(`
      INSERT OR IGNORE INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, created_at
      ) VALUES (
        @sha256, @byteLength, @md5Hex, @dataFormat, 'live', @createdAt
      )
    `),
    getAssetObject: db.prepare(`
      SELECT
        byte_length AS byteLength,
        md5_hex AS md5Hex,
        data_format AS dataFormat,
        gc_state AS gcState
      FROM asset_objects
      WHERE sha256 = ?
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

  function assertImportEnvelopeConsistency(input: ImportSb3CreateProjectInput): void {
    const { envelope } = input;
    if (input.organizationId !== envelope.organizationId) {
      throw new ImportPreconditionError("ENVELOPE_ORGANIZATION_MISMATCH");
    }
    if (input.projectId !== envelope.projectId) {
      throw new ImportPreconditionError("ENVELOPE_PROJECT_MISMATCH");
    }
    if (input.title !== envelope.title) {
      throw new ImportPreconditionError("ENVELOPE_TITLE_MISMATCH");
    }
    if (envelope.revision !== 0) {
      throw new ImportPreconditionError("ENVELOPE_REVISION_NOT_ZERO");
    }
    if (input.ownerUserId !== envelope.updatedByUserId) {
      throw new ImportPreconditionError("ENVELOPE_OWNER_MISMATCH");
    }
    if (envelope.schemaVersion !== envelope.document.schemaVersion) {
      throw new ImportPreconditionError("ENVELOPE_SCHEMA_VERSION_MISMATCH");
    }
  }

  function requiredAssetMap(
    input: ImportSb3CreateProjectInput,
  ): Map<string, AssetObjectInput> {
    const assets = new Map<string, AssetObjectInput>();
    for (const object of input.assetObjects) {
      const existing = assets.get(object.sha256);
      if (
        existing &&
        (existing.byteLength !== object.byteLength ||
          existing.md5Hex !== object.md5Hex ||
          existing.dataFormat !== object.dataFormat)
      ) {
        throw new ImportPreconditionError(
          `DUPLICATE_ASSET_METADATA:${object.sha256}`,
        );
      }
      assets.set(object.sha256, object);
    }

    const documentShas = collectDocumentShas(input.envelope.document);
    const grantShas = new Set(input.grantShas);
    if (
      documentShas.size !== assets.size ||
      grantShas.size !== assets.size ||
      input.grantShas.length !== assets.size
    ) {
      throw new ImportPreconditionError("ASSET_SHA_SET_MISMATCH");
    }
    for (const sha256 of assets.keys()) {
      if (!documentShas.has(sha256) || !grantShas.has(sha256)) {
        throw new ImportPreconditionError(`ASSET_SHA_SET_MISMATCH:${sha256}`);
      }
    }
    return assets;
  }

  function assertFileBytesCurrent(fileBytes: number, now: string): void {
    const row = stmts.getActiveMaterializedBytes.get(now) as {
      materializedBytes: number;
    };
    if (fileBytes < row.materializedBytes) {
      throw new StaleFileBytesError(fileBytes, row.materializedBytes);
    }
  }

  function assertActiveImportResources(
    input: ImportSb3CreateProjectInput,
    now: string,
    assets: Map<string, AssetObjectInput>,
  ): void {
    const activeGlobal = stmts.getActiveGlobalReservation.get(
      input.releaseImportSessionId,
      now,
    );
    if (!activeGlobal) {
      throw new ImportPreconditionError("GLOBAL_RESERVATION_MISSING_OR_EXPIRED");
    }

    const activeQuota = stmts.getActiveQuotaReservation.get(
      input.releaseImportSessionId,
      input.organizationId,
      now,
    ) as { reservationId: string; reservedBytes: number } | undefined;
    if (!activeQuota) {
      throw new ImportPreconditionError("QUOTA_RESERVATION_MISSING_OR_EXPIRED");
    }

    const quotaRows = stmts.getActiveQuotaShas.all(
      input.releaseImportSessionId,
      input.organizationId,
      now,
    ) as Array<{ sha256: string; byteLength: number }>;
    const quotaShas = new Map(
      quotaRows.map((row) => [row.sha256, row.byteLength] as const),
    );
    let expectedReservedBytes = 0;
    for (const [sha256, object] of assets) {
      expectedReservedBytes += object.byteLength;
      if (quotaShas.get(sha256) !== object.byteLength) {
        throw new ImportPreconditionError(`QUOTA_SHA_SET_MISMATCH:${sha256}`);
      }
    }
    if (
      quotaShas.size !== assets.size ||
      activeQuota.reservedBytes !== expectedReservedBytes
    ) {
      throw new ImportPreconditionError("QUOTA_SHA_SET_MISMATCH");
    }

    const leaseRows = stmts.getActiveLeases.all(
      input.releaseImportSessionId,
      input.organizationId,
      now,
    ) as Array<{ leaseId: string; sha256: string }>;
    const leaseShas = new Set(leaseRows.map((row) => row.sha256));
    if (leaseRows.length !== assets.size || leaseShas.size !== assets.size) {
      throw new ImportPreconditionError("LEASE_SHA_SET_MISMATCH");
    }
    for (const sha256 of assets.keys()) {
      if (!leaseShas.has(sha256)) {
        throw new ImportPreconditionError(`LEASE_MISSING:${sha256}`);
      }
    }
  }

  return {
    createGlobalDiskReservation(args) {
      assertByteCount("reservedBytes", args.reservedBytes);
      assertByteCount("fileBytes", args.fileBytes);
      const now = args.now ?? new Date().toISOString();
      withImmediateTransaction(db, () => {
        assertFileBytesCurrent(args.fileBytes, now);
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

    extendGlobalDiskReservation(args) {
      assertByteCount("additionalBytes", args.additionalBytes);
      assertByteCount("fileBytes", args.fileBytes);
      const now = args.now ?? new Date().toISOString();
      withImmediateTransaction(db, () => {
        const active = stmts.getActiveGlobalReservation.get(
          args.importSessionId,
          now,
        );
        if (!active) {
          throw new ReservationNotFoundError(args.importSessionId);
        }
        assertFileBytesCurrent(args.fileBytes, now);
        const used = computeGlobalUsedBytes(db, args.fileBytes, now);
        if (used + args.additionalBytes > GLOBAL_DISK_BYTES) {
          throw new GlobalDiskExceededError();
        }
        const info = stmts.extendGlobalReservation.run({
          importSessionId: args.importSessionId,
          additionalBytes: args.additionalBytes,
          now,
        });
        if (info.changes !== 1) {
          throw new ReservationNotFoundError(args.importSessionId);
        }
      });
    },

    materializeGlobalDiskReservation(args) {
      assertByteCount("deltaBytes", args.deltaBytes);
      const now = args.now ?? new Date().toISOString();
      const info = stmts.materializeGlobal.run({
        importSessionId: args.importSessionId,
        deltaBytes: args.deltaBytes,
        now,
      });
      if (info.changes !== 1) {
        const active = stmts.getActiveGlobalReservation.get(
          args.importSessionId,
          now,
        );
        if (!active) {
          throw new ReservationNotFoundError(args.importSessionId);
        }
        throw new ReservationCapacityExceededError(args.importSessionId);
      }
    },

    releaseGlobalDiskReservation(importSessionId) {
      stmts.deleteGlobalReservation.run(importSessionId);
    },

    releaseImportSession(args) {
      withImmediateTransaction(db, () => {
        stmts.deleteLeasesForSessionForce.run({
          importSessionId: args.importSessionId,
          organizationId: args.organizationId,
        });
        stmts.deleteQuotaReservationForSession.run({
          importSessionId: args.importSessionId,
          organizationId: args.organizationId,
        });
        stmts.deleteGlobalReservation.run(args.importSessionId);
      });
    },

    createImportLeases(args) {
      const now = args.now ?? new Date().toISOString();
      const expiresAt = reservationExpiresAt(now);
      withImmediateTransaction(db, () => {
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
      });
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
      assertByteCount("fileBytes", input.fileBytes);
      const now = input.now ?? new Date().toISOString();

      return withImmediateTransaction(db, () => {
        assertImportEnvelopeConsistency(input);
        const assets = requiredAssetMap(input);
        assertActiveImportResources(input, now, assets);
        assertFileBytesCurrent(input.fileBytes, now);

        const pendingShas: ShaByteLength[] = [...assets.values()].map((o) => ({
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

        const globalUsed = computeGlobalUsedBytes(
          db,
          input.fileBytes,
          now,
          input.releaseImportSessionId,
        );
        if (globalUsed > GLOBAL_DISK_BYTES) {
          throw new GlobalDiskExceededError();
        }

        for (const obj of assets.values()) {
          stmts.insertAssetObject.run({
            sha256: obj.sha256,
            byteLength: obj.byteLength,
            md5Hex: obj.md5Hex,
            dataFormat: obj.dataFormat,
            createdAt: now,
          });
          const stored = stmts.getAssetObject.get(obj.sha256) as
            | {
                byteLength: number;
                md5Hex: string;
                dataFormat: string;
                gcState: "live" | "quarantining" | "quarantined";
              }
            | undefined;
          if (!stored) {
            throw new ImportPreconditionError(
              `ASSET_OBJECT_MISSING:${obj.sha256}`,
            );
          }
          if (stored.gcState !== "live") {
            throw new AssetNotLiveError(obj.sha256);
          }
          if (
            stored.byteLength !== obj.byteLength ||
            stored.md5Hex !== obj.md5Hex ||
            stored.dataFormat !== obj.dataFormat
          ) {
            throw new AssetMetadataMismatchError(obj.sha256);
          }
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
          headRevision: 0,
          createdAt,
          updatedAt: createdAt,
        });
        stmts.insertMember.run(input.projectId, input.ownerUserId, "owner");
        stmts.insertRevision.run({
          projectId: input.projectId,
          revision: 0,
          envelopeJson: JSON.stringify(input.envelope),
          contentHash: input.envelope.contentHash,
          requestHash: "",
          actorUserId: input.ownerUserId,
          createdAt,
          transactionId: null,
        });

        const deletedLeases = stmts.deleteLeasesForSession.run({
          importSessionId: input.releaseImportSessionId,
          organizationId: input.organizationId,
          now,
        }).changes;
        const deletedQuota = stmts.deleteQuotaReservation.run({
          importSessionId: input.releaseImportSessionId,
          organizationId: input.organizationId,
          now,
        }).changes;
        const deletedGlobal = stmts.consumeGlobalReservation.run({
          importSessionId: input.releaseImportSessionId,
          now,
        }).changes;
        if (
          deletedLeases !== assets.size ||
          deletedQuota !== 1 ||
          deletedGlobal !== 1
        ) {
          throw new ImportPreconditionError("RESOURCE_CONSUME_COUNT_MISMATCH");
        }

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

    ...gc,
    ...gcLock,
  };
}
