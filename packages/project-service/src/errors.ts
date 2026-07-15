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
