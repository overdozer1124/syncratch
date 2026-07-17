import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  assertEnvelope,
  contentHash,
  type ProjectEnvelopeV1,
} from "@blocksync/project-envelope";
import type { ProjectDocument } from "@blocksync/project-schema";
import type { SnapshotStore } from "@blocksync/project-service";
import { validateProject } from "@blocksync/project-schema";
import { collectDocumentShas } from "@blocksync/project-store-sqlite";
import { GcScanFailedError, type GcScanContext } from "./gc-types.js";

function addDocumentSha(
  ctx: GcScanContext,
  sha256: string,
  organizationId: string,
): void {
  ctx.documentShas.add(sha256);
  let orgs = ctx.organizationIdsBySha.get(sha256);
  if (!orgs) {
    orgs = new Set<string>();
    ctx.organizationIdsBySha.set(sha256, orgs);
  }
  orgs.add(organizationId);
}

function parseRevisionEnvelopeJson(
  envelopeJson: string,
  detail: string,
): ProjectEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson);
  } catch {
    throw new GcScanFailedError("REVISION_JSON_INVALID", detail);
  }
  try {
    return assertEnvelope(parsed);
  } catch {
    throw new GcScanFailedError("REVISION_DOCUMENT_INVALID", detail);
  }
}

function validateRevisionRow(
  row: {
    projectId: string;
    revision: number;
    envelopeJson: string;
    contentHash: string;
    organizationId: string;
  },
): ProjectDocument {
  const detail = `${row.projectId}@${row.revision}`;
  const envelope = parseRevisionEnvelopeJson(row.envelopeJson, detail);
  if (envelope.projectId !== row.projectId) {
    throw new GcScanFailedError("REVISION_DOCUMENT_INVALID", detail);
  }
  if (envelope.revision !== row.revision) {
    throw new GcScanFailedError("REVISION_DOCUMENT_INVALID", detail);
  }
  if (envelope.organizationId !== row.organizationId) {
    throw new GcScanFailedError("REVISION_DOCUMENT_INVALID", detail);
  }
  if (envelope.contentHash !== row.contentHash) {
    throw new GcScanFailedError("REVISION_DOCUMENT_INVALID", detail);
  }
  const validation = validateProject(envelope.document);
  if (!validation.ok) {
    throw new GcScanFailedError("REVISION_DOCUMENT_INVALID", detail);
  }
  if (contentHash(envelope.document) !== row.contentHash) {
    throw new GcScanFailedError("REVISION_DOCUMENT_INVALID", detail);
  }
  return envelope.document;
}

function parseSnapshotDocument(
  bytes: Uint8Array,
  expectedContentHash: string,
  storageKey: string,
): ProjectDocument {
  const rawHash = createHash("sha256").update(bytes).digest("hex");
  if (rawHash !== expectedContentHash) {
    throw new GcScanFailedError("SNAPSHOT_RAW_HASH_MISMATCH", storageKey);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new GcScanFailedError("SNAPSHOT_JSON_INVALID", storageKey);
  }
  const validation = validateProject(parsed as ProjectDocument);
  if (!validation.ok) {
    throw new GcScanFailedError("SNAPSHOT_DOCUMENT_INVALID", storageKey);
  }
  const doc = parsed as ProjectDocument;
  if (contentHash(doc) !== expectedContentHash) {
    throw new GcScanFailedError("SNAPSHOT_HASH_MISMATCH", storageKey);
  }
  return doc;
}

export function collectLiveReferencedShas(
  db: Database.Database,
  snapshotStore: SnapshotStore,
  now: string,
): Set<string> {
  const referenced = new Set<string>();

  const leaseRows = db
    .prepare(
      `SELECT sha256 FROM asset_import_leases WHERE expires_at > ?`,
    )
    .all(now) as Array<{ sha256: string }>;
  for (const row of leaseRows) {
    referenced.add(row.sha256);
  }

  const revisionRows = db
    .prepare(
      `
      SELECT
        r.project_id AS projectId,
        r.revision AS revision,
        r.envelope_json AS envelopeJson,
        r.content_hash AS contentHash,
        p.organization_id AS organizationId
      FROM project_revisions r
      INNER JOIN projects p ON p.id = r.project_id
    `,
    )
    .all() as Array<{
    projectId: string;
    revision: number;
    envelopeJson: string;
    contentHash: string;
    organizationId: string;
  }>;

  for (const row of revisionRows) {
    const document = validateRevisionRow(row);
    for (const sha256 of collectDocumentShas(document)) {
      referenced.add(sha256);
    }
  }

  const snapshotRows = db
    .prepare(
      `
      SELECT
        s.storage_key AS storageKey,
        s.content_hash AS contentHash
      FROM project_snapshots s
    `,
    )
    .all() as Array<{ storageKey: string; contentHash: string }>;

  for (const row of snapshotRows) {
    const bytes = snapshotStore.get(row.storageKey);
    if (!bytes) {
      throw new GcScanFailedError("SNAPSHOT_BLOB_MISSING", row.storageKey);
    }
    const document = parseSnapshotDocument(
      bytes,
      row.contentHash,
      row.storageKey,
    );
    for (const sha256 of collectDocumentShas(document)) {
      referenced.add(sha256);
    }
  }

  return referenced;
}

export function isSha256ReferencedLive(
  db: Database.Database,
  snapshotStore: SnapshotStore,
  sha256: string,
  now: string,
): boolean {
  return collectLiveReferencedShas(db, snapshotStore, now).has(sha256);
}

export function buildGcScanContextFromDb(
  db: Database.Database,
  snapshotStore: SnapshotStore,
): GcScanContext {
  const ctx: GcScanContext = {
    documentShas: new Set<string>(),
    organizationIdsBySha: new Map<string, Set<string>>(),
  };

  const revisionRows = db
    .prepare(
      `
      SELECT
        r.project_id AS projectId,
        r.revision AS revision,
        r.envelope_json AS envelopeJson,
        r.content_hash AS contentHash,
        p.organization_id AS organizationId
      FROM project_revisions r
      INNER JOIN projects p ON p.id = r.project_id
    `,
    )
    .all() as Array<{
    projectId: string;
    revision: number;
    envelopeJson: string;
    contentHash: string;
    organizationId: string;
  }>;

  for (const row of revisionRows) {
    const document = validateRevisionRow(row);
    for (const sha256 of collectDocumentShas(document)) {
      addDocumentSha(ctx, sha256, row.organizationId);
    }
  }

  const snapshotRows = db
    .prepare(
      `
      SELECT
        s.storage_key AS storageKey,
        s.content_hash AS contentHash,
        p.organization_id AS organizationId
      FROM project_snapshots s
      INNER JOIN projects p ON p.id = s.project_id
    `,
    )
    .all() as Array<{
    storageKey: string;
    contentHash: string;
    organizationId: string;
  }>;

  for (const row of snapshotRows) {
    const bytes = snapshotStore.get(row.storageKey);
    if (!bytes) {
      throw new GcScanFailedError("SNAPSHOT_BLOB_MISSING", row.storageKey);
    }
    const document = parseSnapshotDocument(
      bytes,
      row.contentHash,
      row.storageKey,
    );
    for (const sha256 of collectDocumentShas(document)) {
      addDocumentSha(ctx, sha256, row.organizationId);
    }
  }

  return ctx;
}
