import {
  DriveAuthenticationError,
  DriveConflictError,
  DriveInvalidFileError,
  DriveInvalidResponseError,
  DriveNetworkError,
  DrivePermissionError,
  DriveQuotaError,
  DriveSyncError,
} from "./errors.js";
import {SB3_MIME_TYPE} from "./picker.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const DEFAULT_MAX_SB3_BYTES = 5 * 1024 * 1024;
const METADATA_FIELDS = [
  "id",
  "name",
  "mimeType",
  "size",
  "version",
  "headRevisionId",
  "appProperties",
  "capabilities(canEdit,canDownload)",
].join(",");

export interface DriveSnapshot {
  snapshotId: string;
  leadershipEpoch: string;
  stateHash: string;
}

export interface DriveObservation {
  version: string;
  snapshotId: string | null;
}

export interface DriveFileMetadata extends DriveObservation {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  headRevisionId: string | null;
  leadershipEpoch: string | null;
  stateHash: string | null;
  canEdit: boolean;
  canDownload: boolean;
}

export interface DriveWriteResult {
  fileId: string;
  observation: DriveObservation;
}

export interface CreateDriveFileInput {
  name: string;
  bytes: Uint8Array;
  snapshot: DriveSnapshot;
}

export interface UpdateDriveFileInput {
  fileId: string;
  bytes: Uint8Array;
  knownObservation: DriveObservation;
  snapshot: DriveSnapshot;
}

export interface DriveRestAdapter {
  getMetadata(fileId: string): Promise<DriveFileMetadata>;
  readFile(fileId: string): Promise<{
    metadata: DriveFileMetadata;
    bytes: Uint8Array;
  }>;
  createFile(input: CreateDriveFileInput): Promise<DriveWriteResult>;
  updateFile(input: UpdateDriveFileInput): Promise<DriveWriteResult>;
}

export interface DriveRestAdapterOptions {
  fetch: typeof fetch;
  getAccessToken: () => string | null;
  validateSb3: (bytes: Uint8Array) => Promise<boolean>;
  maxBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseError(response: Response): Promise<DriveSyncError> {
  let reason = "";
  try {
    const body: unknown = await response.clone().json();
    if (isRecord(body) && isRecord(body.error)) {
      const errors = body.error.errors;
      if (Array.isArray(errors) && isRecord(errors[0])) {
        reason = typeof errors[0].reason === "string" ? errors[0].reason : "";
      }
    }
  } catch {
    // Status remains authoritative when Google returns a non-JSON error page.
  }
  if (response.status === 401) {
    return new DriveAuthenticationError("Google access token expired");
  }
  if (
    response.status === 429 ||
    ["rateLimitExceeded", "userRateLimitExceeded", "storageQuotaExceeded"]
      .includes(reason)
  ) {
    return new DriveQuotaError("Google Drive quota or rate limit exceeded");
  }
  if (response.status === 403) {
    return new DrivePermissionError("Google Drive permission denied");
  }
  if (response.status === 404) {
    return new DriveInvalidFileError("Google Drive file was not found");
  }
  if (response.status >= 500) {
    return new DriveNetworkError(
      `Google Drive service failed (${response.status})`,
    );
  }
  return new DriveInvalidResponseError(
    `Unexpected Google Drive response (${response.status})`,
  );
}

function parseMetadata(value: unknown): DriveFileMetadata {
  if (!isRecord(value)) {
    throw new DriveInvalidResponseError("Drive metadata is not an object");
  }
  const appProperties = isRecord(value.appProperties)
    ? value.appProperties
    : {};
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  const size = typeof value.size === "string" ? Number(value.size) : value.size;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.mimeType !== "string" ||
    typeof value.version !== "string" ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0
  ) {
    throw new DriveInvalidResponseError("Drive metadata fields are invalid");
  }
  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    size,
    version: value.version,
    headRevisionId: typeof value.headRevisionId === "string"
      ? value.headRevisionId
      : null,
    snapshotId: typeof appProperties.blocksyncSnapshotId === "string"
      ? appProperties.blocksyncSnapshotId
      : null,
    leadershipEpoch:
      typeof appProperties.blocksyncLeadershipEpoch === "string"
        ? appProperties.blocksyncLeadershipEpoch
        : null,
    stateHash: typeof appProperties.blocksyncStateHash === "string"
      ? appProperties.blocksyncStateHash
      : null,
    canEdit: capabilities.canEdit === true,
    canDownload: capabilities.canDownload === true,
  };
}

function snapshotMetadata(snapshot: DriveSnapshot): Record<string, string> {
  return {
    blocksyncSnapshotId: snapshot.snapshotId,
    blocksyncLeadershipEpoch: snapshot.leadershipEpoch,
    blocksyncStateHash: snapshot.stateHash,
  };
}

function multipartBody(
  name: string | undefined,
  bytes: Uint8Array,
  snapshot: DriveSnapshot,
): {body: Blob; contentType: string} {
  const metadata: Record<string, unknown> = {
    mimeType: SB3_MIME_TYPE,
    appProperties: snapshotMetadata(snapshot),
  };
  if (name !== undefined) metadata.name = name;
  const boundary = `blocksync_${crypto.randomUUID().replaceAll("-", "")}`;
  const body = new Blob([
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${SB3_MIME_TYPE}\r\n\r\n`,
    bytes as BlobPart,
    `\r\n--${boundary}--\r\n`,
  ]);
  return {
    body,
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

export function createDriveRestAdapter(
  options: DriveRestAdapterOptions,
): DriveRestAdapter {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SB3_BYTES;

  const authorizedFetch = async (
    url: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const accessToken = options.getAccessToken();
    if (!accessToken) {
      throw new DriveAuthenticationError("Google is not connected");
    }
    let result: Response;
    try {
      result = await options.fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...init.headers,
        },
      });
    } catch (error) {
      throw new DriveNetworkError("Google Drive request failed", {cause: error});
    }
    if (!result.ok) throw await responseError(result);
    return result;
  };

  const getMetadata = async (fileId: string): Promise<DriveFileMetadata> => {
    const query = new URLSearchParams({
      fields: METADATA_FIELDS,
      supportsAllDrives: "true",
    });
    const result = await authorizedFetch(
      `${DRIVE_API}/${encodeURIComponent(fileId)}?${query}`,
    );
    try {
      return parseMetadata(await result.json());
    } catch (error) {
      if (error instanceof DriveInvalidResponseError) throw error;
      throw new DriveInvalidResponseError(
        "Drive metadata was not valid JSON",
        {cause: error},
      );
    }
  };

  const confirmAttempt = async (
    fileId: string,
    attemptedSnapshotId: string,
  ): Promise<DriveWriteResult> => {
    try {
      const after = await getMetadata(fileId);
      if (after.snapshotId !== attemptedSnapshotId) {
        throw new DriveConflictError(
          "Drive changed during upload; automatic saves are stopped",
          "post-write",
        );
      }
      return {
        fileId,
        observation: {
          version: after.version,
          snapshotId: after.snapshotId,
        },
      };
    } catch (error) {
      if (error instanceof DriveSyncError) error.fileId ??= fileId;
      throw error;
    }
  };

  return {
    getMetadata,
    async readFile(fileId) {
      const metadata = await getMetadata(fileId);
      if (!metadata.canDownload) {
        throw new DrivePermissionError("Drive file cannot be downloaded");
      }
      if (
        metadata.size > maxBytes ||
        !metadata.name.toLowerCase().endsWith(".sb3") ||
        metadata.mimeType !== SB3_MIME_TYPE
      ) {
        throw new DriveInvalidFileError(
          "Selected Drive file is not a supported .sb3",
        );
      }
      const query = new URLSearchParams({alt: "media", supportsAllDrives: "true"});
      const result = await authorizedFetch(
        `${DRIVE_API}/${encodeURIComponent(fileId)}?${query}`,
      );
      const declaredSize = Number(result.headers.get("content-length"));
      if (
        Number.isFinite(declaredSize) &&
        declaredSize > maxBytes
      ) {
        throw new DriveInvalidFileError("Drive .sb3 exceeds the size limit");
      }
      const bytes = new Uint8Array(await result.arrayBuffer());
      if (bytes.byteLength > maxBytes || bytes.byteLength !== metadata.size) {
        throw new DriveInvalidFileError("Drive .sb3 size is invalid");
      }
      if (!await options.validateSb3(bytes)) {
        throw new DriveInvalidFileError("Drive file is not a valid .sb3");
      }
      return {metadata, bytes};
    },
    async createFile(input) {
      if (input.bytes.byteLength > maxBytes) {
        throw new DriveInvalidFileError("Drive .sb3 exceeds the size limit");
      }
      const query = new URLSearchParams({uploadType: "multipart"});
      const multipart = multipartBody(input.name, input.bytes, input.snapshot);
      const result = await authorizedFetch(`${DRIVE_UPLOAD_API}?${query}`, {
        method: "POST",
        headers: {"Content-Type": multipart.contentType},
        body: multipart.body,
      });
      const value: unknown = await result.json();
      if (!isRecord(value) || typeof value.id !== "string") {
        throw new DriveInvalidResponseError(
          "Drive create response has no file ID",
        );
      }
      return confirmAttempt(value.id, input.snapshot.snapshotId);
    },
    async updateFile(input) {
      if (input.bytes.byteLength > maxBytes) {
        throw new DriveInvalidFileError("Drive .sb3 exceeds the size limit");
      }
      const before = await getMetadata(input.fileId);
      if (!before.canEdit) {
        throw new DrivePermissionError("Drive file is no longer editable");
      }
      if (
        before.version !== input.knownObservation.version ||
        before.snapshotId !== input.knownObservation.snapshotId
      ) {
        throw new DriveConflictError(
          "Drive file differs from the last observed version",
          "pre-write",
        );
      }
      const query = new URLSearchParams({uploadType: "multipart"});
      const multipart = multipartBody(undefined, input.bytes, input.snapshot);
      await authorizedFetch(
        `${DRIVE_UPLOAD_API}/${encodeURIComponent(input.fileId)}?${query}`,
        {
          method: "PATCH",
          headers: {"Content-Type": multipart.contentType},
          body: multipart.body,
        },
      );
      return confirmAttempt(input.fileId, input.snapshot.snapshotId);
    },
  };
}
