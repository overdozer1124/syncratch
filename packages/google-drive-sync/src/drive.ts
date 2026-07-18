import {
  DriveAuthenticationError,
  DriveConflictError,
  DriveFileNotFoundError,
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
  fileId: string;
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
  getMetadata(fileId: string, signal?: AbortSignal): Promise<DriveFileMetadata>;
  readFile(fileId: string, signal?: AbortSignal): Promise<{
    metadata: DriveFileMetadata;
    bytes: Uint8Array;
  }>;
  reserveFileId(signal?: AbortSignal): Promise<string>;
  createFile(
    input: CreateDriveFileInput,
    signal?: AbortSignal,
  ): Promise<DriveWriteResult>;
  updateFile(
    input: UpdateDriveFileInput,
    signal?: AbortSignal,
  ): Promise<DriveWriteResult>;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
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
    return new DriveFileNotFoundError("Google Drive file was not found");
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
  fileId: string | undefined,
  name: string | undefined,
  bytes: Uint8Array,
  snapshot: DriveSnapshot,
): {body: Blob; contentType: string} {
  const metadata: Record<string, unknown> = {
    mimeType: SB3_MIME_TYPE,
    appProperties: snapshotMetadata(snapshot),
  };
  if (fileId !== undefined) metadata.id = fileId;
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
    signal?: AbortSignal,
  ): Promise<Response> => {
    throwIfAborted(signal);
    const accessToken = options.getAccessToken();
    if (!accessToken) {
      throw new DriveAuthenticationError("Google is not connected");
    }
    let result: Response;
    try {
      result = await options.fetch(url, {
        ...init,
        signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...init.headers,
        },
      });
    } catch (error) {
      if (signal?.aborted) {
        throwIfAborted(signal);
      }
      throw new DriveNetworkError("Google Drive request failed", {cause: error});
    }
    if (!result.ok) throw await responseError(result);
    return result;
  };

  const getMetadata = async (
    fileId: string,
    signal?: AbortSignal,
  ): Promise<DriveFileMetadata> => {
    const query = new URLSearchParams({
      fields: METADATA_FIELDS,
      supportsAllDrives: "true",
    });
    const result = await authorizedFetch(
      `${DRIVE_API}/${encodeURIComponent(fileId)}?${query}`,
      {},
      signal,
    );
    throwIfAborted(signal);
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

  const reserveFileId = async (signal?: AbortSignal): Promise<string> => {
    const query = new URLSearchParams({
      count: "1",
      space: "drive",
      type: "files",
    });
    const result = await authorizedFetch(
      `${DRIVE_API}/generateIds?${query}`,
      {},
      signal,
    );
    throwIfAborted(signal);
    let value: unknown;
    try {
      value = await result.json();
    } catch (error) {
      throw new DriveInvalidResponseError(
        "Drive generated ID response was not valid JSON",
        {cause: error},
      );
    }
    if (
      !isRecord(value) ||
      !Array.isArray(value.ids) ||
      typeof value.ids[0] !== "string"
    ) {
      throw new DriveInvalidResponseError(
        "Drive generated ID response has no file ID",
      );
    }
    return value.ids[0];
  };

  const confirmAttempt = async (
    fileId: string,
    attemptedSnapshotId: string,
    signal?: AbortSignal,
  ): Promise<DriveWriteResult> => {
    try {
      const after = await getMetadata(fileId, signal);
      throwIfAborted(signal);
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
    reserveFileId,
    async readFile(fileId, signal) {
      const metadata = await getMetadata(fileId, signal);
      throwIfAborted(signal);
      if (!metadata.canDownload) {
        throw new DrivePermissionError("Drive file cannot be downloaded");
      }
      if (
        metadata.size > maxBytes ||
        !metadata.name.toLowerCase().endsWith(".sb3")
      ) {
        throw new DriveInvalidFileError(
          "Selected Drive file is not a supported .sb3",
        );
      }
      const query = new URLSearchParams({alt: "media", supportsAllDrives: "true"});
      const result = await authorizedFetch(
        `${DRIVE_API}/${encodeURIComponent(fileId)}?${query}`,
        {},
        signal,
      );
      throwIfAborted(signal);
      const declaredSize = Number(result.headers.get("content-length"));
      if (
        Number.isFinite(declaredSize) &&
        declaredSize > maxBytes
      ) {
        throw new DriveInvalidFileError("Drive .sb3 exceeds the size limit");
      }
      if (!result.body) {
        throw new DriveInvalidFileError(
          "Drive download has no readable response body",
        );
      }
      const reader = result.body.getReader();
      const cancelOnAbort = (): void => {
        void reader.cancel(signal?.reason).catch(() => undefined);
      };
      signal?.addEventListener("abort", cancelOnAbort, {once: true});
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          throwIfAborted(signal);
          const {done, value} = await reader.read();
          throwIfAborted(signal);
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new DriveInvalidFileError(
              "Drive .sb3 exceeds the size limit",
            );
          }
          chunks.push(value);
        }
      } finally {
        signal?.removeEventListener("abort", cancelOnAbort);
      }
      if (total !== metadata.size) {
        throw new DriveInvalidFileError("Drive .sb3 size is invalid");
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (!await options.validateSb3(bytes)) {
        throw new DriveInvalidFileError("Drive file is not a valid .sb3");
      }
      return {metadata, bytes};
    },
    async createFile(input, signal) {
      if (input.bytes.byteLength > maxBytes) {
        throw new DriveInvalidFileError("Drive .sb3 exceeds the size limit");
      }
      const fileId = input.fileId;
      try {
        const query = new URLSearchParams({
          uploadType: "multipart",
          supportsAllDrives: "true",
        });
        const multipart = multipartBody(
          fileId,
          input.name,
          input.bytes,
          input.snapshot,
        );
        const result = await authorizedFetch(`${DRIVE_UPLOAD_API}?${query}`, {
          method: "POST",
          headers: {"Content-Type": multipart.contentType},
          body: multipart.body,
        }, signal);
        throwIfAborted(signal);
        let value: unknown;
        try {
          value = await result.json();
        } catch (error) {
          throw new DriveInvalidResponseError(
            "Drive create response was not valid JSON",
            {cause: error},
          );
        }
        if (!isRecord(value) || value.id !== fileId) {
          throw new DriveInvalidResponseError(
            "Drive create response did not confirm the reserved file ID",
          );
        }
        return await confirmAttempt(
          fileId,
          input.snapshot.snapshotId,
          signal,
        );
      } catch (error) {
        const typed = error instanceof DriveSyncError
          ? error
          : new DriveInvalidResponseError(
            "Drive create response could not be processed",
            {cause: error},
          );
        typed.fileId ??= fileId;
        throw typed;
      }
    },
    async updateFile(input, signal) {
      if (input.bytes.byteLength > maxBytes) {
        throw new DriveInvalidFileError("Drive .sb3 exceeds the size limit");
      }
      const before = await getMetadata(input.fileId, signal);
      throwIfAborted(signal);
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
      const query = new URLSearchParams({
        uploadType: "multipart",
        supportsAllDrives: "true",
      });
      const multipart = multipartBody(
        undefined,
        undefined,
        input.bytes,
        input.snapshot,
      );
      await authorizedFetch(
        `${DRIVE_UPLOAD_API}/${encodeURIComponent(input.fileId)}?${query}`,
        {
          method: "PATCH",
          headers: {"Content-Type": multipart.contentType},
          body: multipart.body,
        },
        signal,
      );
      throwIfAborted(signal);
      return confirmAttempt(
        input.fileId,
        input.snapshot.snapshotId,
        signal,
      );
    },
  };
}
