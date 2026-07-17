import type Database from "better-sqlite3";

/** Union of validated document shas (snapshots + revisions at scan time) and active leases. */
export function collectReferencedShas(
  db: Database.Database,
  now: string,
  validatedDocumentShas: Iterable<string> = [],
): Set<string> {
  const referenced = new Set<string>();

  for (const sha256 of validatedDocumentShas) {
    referenced.add(sha256);
  }

  const leaseRows = db
    .prepare(
      `SELECT sha256 FROM asset_import_leases WHERE expires_at > ?`,
    )
    .all(now) as Array<{ sha256: string }>;
  for (const row of leaseRows) {
    referenced.add(row.sha256);
  }

  return referenced;
}

export function isShaReferenced(
  db: Database.Database,
  sha256: string,
  now: string,
  validatedDocumentShas: Iterable<string> = [],
): boolean {
  return collectReferencedShas(db, now, validatedDocumentShas).has(sha256);
}

/** Organizations whose active leases or scan-time document references include sha256. */
export function listOrganizationsReferencingSha(
  db: Database.Database,
  sha256: string,
  now: string,
  organizationIdsFromScan: Iterable<string> = [],
): Set<string> {
  const orgs = new Set<string>();

  const leaseRows = db
    .prepare(
      `
      SELECT organization_id AS organizationId
      FROM asset_import_leases
      WHERE sha256 = ? AND expires_at > ?
    `,
    )
    .all(sha256, now) as Array<{ organizationId: string }>;
  for (const row of leaseRows) {
    orgs.add(row.organizationId);
  }

  for (const organizationId of organizationIdsFromScan) {
    orgs.add(organizationId);
  }

  return orgs;
}
