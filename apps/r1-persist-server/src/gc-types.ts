export class GcScanFailedError extends Error {
  constructor(
    public readonly reason:
      | "SNAPSHOT_BLOB_MISSING"
      | "SNAPSHOT_JSON_INVALID"
      | "SNAPSHOT_RAW_HASH_MISMATCH"
      | "SNAPSHOT_HASH_MISMATCH"
      | "SNAPSHOT_DOCUMENT_INVALID"
      | "REVISION_JSON_INVALID"
      | "REVISION_DOCUMENT_MISSING"
      | "REVISION_DOCUMENT_INVALID",
    public readonly detail?: string,
  ) {
    super(`GC_SCAN_FAILED:${reason}${detail ? `:${detail}` : ""}`);
    this.name = "GcScanFailedError";
  }
}

export interface GcScanContext {
  documentShas: Set<string>;
  organizationIdsBySha: Map<string, Set<string>>;
}

/** @deprecated Use GcScanContext */
export type SnapshotGcContext = GcScanContext;
