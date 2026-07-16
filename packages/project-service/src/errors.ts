import type { ValidationIssue } from "@blocksync/project-schema";

export class TransactionPayloadMismatchError extends Error {
  readonly code = "TRANSACTION_PAYLOAD_MISMATCH" as const;
  constructor(message = "TRANSACTION_PAYLOAD_MISMATCH") {
    super(message);
    this.name = "TransactionPayloadMismatchError";
  }
}

export class StaleRevisionError extends Error {
  readonly code = "STALE_REVISION" as const;
  constructor(message = "STALE_REVISION") {
    super(message);
    this.name = "StaleRevisionError";
  }
}

export class SchemaInvalidError extends Error {
  readonly code = "SCHEMA_INVALID" as const;
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[], message = "SCHEMA_INVALID") {
    super(message);
    this.name = "SchemaInvalidError";
    this.issues = issues;
  }
}

export class SchemaVersionMismatchError extends Error {
  readonly code = "SCHEMA_VERSION_MISMATCH" as const;
  constructor(message = "SCHEMA_VERSION_MISMATCH") {
    super(message);
    this.name = "SchemaVersionMismatchError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN" as const;
  constructor(message = "FORBIDDEN") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(message = "NOT_FOUND") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  constructor(message = "UNAUTHORIZED") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class BadRequestError extends Error {
  readonly code = "BAD_REQUEST" as const;
  constructor(message = "BAD_REQUEST") {
    super(message);
    this.name = "BadRequestError";
  }
}

/** Corrupt or hash-mismatched snapshot blob (HTTP 422). */
export class SnapshotHashMismatchError extends Error {
  readonly code = "SNAPSHOT_HASH_MISMATCH" as const;
  constructor(message = "SNAPSHOT_HASH_MISMATCH") {
    super(message);
    this.name = "SnapshotHashMismatchError";
  }
}

export class AssetNotLiveError extends Error {
  readonly code = "ASSET_NOT_LIVE" as const;
  constructor(sha256: string) {
    super(`ASSET_NOT_LIVE:${sha256}`);
    this.name = "AssetNotLiveError";
  }
}

export class AssetNotGrantedError extends Error {
  readonly code = "ASSET_NOT_GRANTED" as const;
  constructor(sha256: string) {
    super(`ASSET_NOT_GRANTED:${sha256}`);
    this.name = "AssetNotGrantedError";
  }
}

export class AssetRefMismatchError extends Error {
  readonly code = "ASSET_REF_MISMATCH" as const;
  constructor(detail: string) {
    super(`ASSET_REF_MISMATCH:${detail}`);
    this.name = "AssetRefMismatchError";
  }
}

export class AssetIntegrityError extends Error {
  readonly code = "ASSET_INTEGRITY" as const;
  constructor(sha256: string, detail: string) {
    super(`ASSET_INTEGRITY:${sha256}:${detail}`);
    this.name = "AssetIntegrityError";
  }
}

export class ImportPreconditionError extends Error {
  readonly code = "IMPORT_PRECONDITION" as const;
  constructor(detail: string) {
    super(`IMPORT_PRECONDITION:${detail}`);
    this.name = "ImportPreconditionError";
  }
}
