import type Database from "better-sqlite3";

interface DocumentLike {
  targets?: Array<{
    costumes?: Array<{ contentSha256?: string }>;
    sounds?: Array<{ contentSha256?: string }>;
  }>;
}

/** Collect distinct contentSha256 values from a project document. */
export function collectDocumentShas(document: DocumentLike): Set<string> {
  const shas = new Set<string>();
  for (const target of document.targets ?? []) {
    for (const costume of target.costumes ?? []) {
      if (costume.contentSha256) {
        shas.add(costume.contentSha256);
      }
    }
    for (const sound of target.sounds ?? []) {
      if (sound.contentSha256) {
        shas.add(sound.contentSha256);
      }
    }
  }
  return shas;
}

export interface ShaByteLength {
  sha256: string;
  byteLength: number;
}

/**
 * Distinct sha union byte sum for an organization (Design §4.6.1).
 * Includes durable revision references and active quota reservation shas.
 */
export function computeOrgQuotaBytes(
  db: Database.Database,
  organizationId: string,
  now: string,
  pendingShas?: Iterable<ShaByteLength>,
): number {
  const shaBytes = new Map<string, number>();

  const revisionRows = db
    .prepare(
      `
      SELECT r.envelope_json AS envelopeJson
      FROM project_revisions r
      INNER JOIN projects p ON p.id = r.project_id
      WHERE p.organization_id = ?
    `,
    )
    .all(organizationId) as Array<{ envelopeJson: string }>;

  for (const row of revisionRows) {
    const envelope = JSON.parse(row.envelopeJson) as {
      document?: DocumentLike;
    };
    if (!envelope.document) continue;
    for (const sha of collectDocumentShas(envelope.document)) {
      if (!shaBytes.has(sha)) {
        const objectRow = db
          .prepare(
            `SELECT byte_length AS byteLength FROM asset_objects WHERE sha256 = ?`,
          )
          .get(sha) as { byteLength: number } | undefined;
        if (objectRow) {
          shaBytes.set(sha, objectRow.byteLength);
        }
      }
    }
  }

  const reservationRows = db
    .prepare(
      `
      SELECT s.sha256 AS sha256, s.byte_length AS byteLength
      FROM organization_asset_quota_reservation_shas s
      INNER JOIN organization_asset_quota_reservations r
        ON r.reservation_id = s.reservation_id
      WHERE r.organization_id = ? AND r.expires_at > ?
    `,
    )
    .all(organizationId, now) as Array<{ sha256: string; byteLength: number }>;

  for (const row of reservationRows) {
    if (!shaBytes.has(row.sha256)) {
      shaBytes.set(row.sha256, row.byteLength);
    }
  }

  if (pendingShas) {
    for (const pending of pendingShas) {
      if (!shaBytes.has(pending.sha256)) {
        shaBytes.set(pending.sha256, pending.byteLength);
      }
    }
  }

  let total = 0;
  for (const byteLength of shaBytes.values()) {
    total += byteLength;
  }
  return total;
}

/** Global disk usage: on-disk bytes + active reservation net (Design §4.6.2). */
export function computeGlobalUsedBytes(
  db: Database.Database,
  fileBytes: number,
  now: string,
  excludeImportSessionId?: string,
): number {
  let reservationNet = 0;
  const rows = db
    .prepare(
      `
      SELECT import_session_id AS importSessionId,
             reserved_bytes AS reservedBytes,
             materialized_bytes AS materializedBytes
      FROM global_disk_reservations
      WHERE expires_at > ?
    `,
    )
    .all(now) as Array<{
    importSessionId: string;
    reservedBytes: number;
    materializedBytes: number;
  }>;

  for (const row of rows) {
    if (excludeImportSessionId && row.importSessionId === excludeImportSessionId) {
      continue;
    }
    reservationNet += row.reservedBytes - row.materializedBytes;
  }

  return fileBytes + reservationNet;
}
