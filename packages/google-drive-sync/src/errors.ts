export type DriveErrorCode =
  | "configuration"
  | "authentication"
  | "permission"
  | "quota"
  | "network"
  | "invalid-file"
  | "invalid-response"
  | "conflict";

export class DriveSyncError extends Error {
  fileId?: string;

  constructor(
    message: string,
    readonly code: DriveErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DriveSyncError";
  }
}

export class DriveConfigurationError extends DriveSyncError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "configuration", options);
    this.name = "DriveConfigurationError";
  }
}

export class DriveAuthenticationError extends DriveSyncError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "authentication", options);
    this.name = "DriveAuthenticationError";
  }
}

export class DrivePermissionError extends DriveSyncError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "permission", options);
    this.name = "DrivePermissionError";
  }
}

export class DriveQuotaError extends DriveSyncError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "quota", options);
    this.name = "DriveQuotaError";
  }
}

export class DriveNetworkError extends DriveSyncError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "network", options);
    this.name = "DriveNetworkError";
  }
}

export class DriveInvalidFileError extends DriveSyncError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "invalid-file", options);
    this.name = "DriveInvalidFileError";
  }
}

export class DriveInvalidResponseError extends DriveSyncError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "invalid-response", options);
    this.name = "DriveInvalidResponseError";
  }
}

export class DriveConflictError extends DriveSyncError {
  constructor(
    message: string,
    readonly phase: "pre-write" | "post-write",
  ) {
    super(message, "conflict");
    this.name = "DriveConflictError";
  }
}
