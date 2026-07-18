import {describe, expect, it, vi} from "vitest";
import {
  DRIVE_FILE_SCOPE,
  DriveAuthenticationError,
  DriveConflictError,
  DriveInvalidFileError,
  DriveNetworkError,
  DrivePermissionError,
  DriveQuotaError,
  createDriveRestAdapter,
  createGoogleAuthorization,
  createGooglePicker,
  loadGoogleScripts,
} from "./index.js";

const validSb3 = new Uint8Array([80, 75, 3, 4]);

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(
    body instanceof Uint8Array ? body : JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": body instanceof Uint8Array
          ? "application/x.scratch.sb3"
          : "application/json",
        ...headers,
      },
    },
  );
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    name: "Project.sb3",
    mimeType: "application/x.scratch.sb3",
    size: "4",
    version: "7",
    headRevisionId: "head-7",
    appProperties: {
      blocksyncSnapshotId: "snapshot-1",
      blocksyncLeadershipEpoch: "3",
      blocksyncStateHash: "hash-1",
    },
    capabilities: {canEdit: true, canDownload: true},
    ...overrides,
  };
}

describe("Google authorization", () => {
  it("requests exactly drive.file and retains the token only in memory", async () => {
    let configuredScope = "";
    let callback: (value: {access_token?: string; error?: string}) => void =
      () => undefined;
    const storageWrites = vi.fn();
    vi.stubGlobal("localStorage", {setItem: storageWrites});
    const auth = createGoogleAuthorization({
      clientId: "client-id",
      loadScripts: async () => undefined,
      getGoogle: () => ({
        accounts: {
          oauth2: {
            initTokenClient(config) {
              configuredScope = config.scope;
              callback = config.callback;
              return {
                requestAccessToken() {
                  callback({access_token: "memory-token"});
                },
              };
            },
            revoke: vi.fn(),
          },
        },
      }),
    });

    await expect(auth.connect()).resolves.toBe("memory-token");
    expect(configuredScope).toBe(DRIVE_FILE_SCOPE);
    expect(DRIVE_FILE_SCOPE).toBe(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(auth.getAccessToken()).toBe("memory-token");
    expect(storageWrites).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("Google script loading", () => {
  it("does not add scripts until explicitly requested and loads each once", async () => {
    const appended: string[] = [];
    const loader = loadGoogleScripts({
      appendScript: async source => {
        appended.push(source);
      },
    });

    expect(appended).toEqual([]);
    await loader();
    await loader();

    expect(appended).toEqual([
      "https://accounts.google.com/gsi/client",
      "https://apis.google.com/js/api.js",
    ]);
  });
});

describe("Google Picker", () => {
  it("returns null on cancellation and the selected file ID on pick", async () => {
    let pickerCallback: (data: Record<string, unknown>) => void =
      () => undefined;
    const picker = createGooglePicker({
      apiKey: "api-key",
      appId: "app-id",
      initializePicker: async () => undefined,
      buildPicker: options => {
        pickerCallback = options.callback;
        expect(options.mimeType).toBe("application/x.scratch.sb3");
        expect(options.accessToken).toBe("token");
        return {setVisible: vi.fn()};
      },
    });

    const cancelled = picker.pickFile("token");
    await Promise.resolve();
    pickerCallback({action: "cancel"});
    await expect(cancelled).resolves.toBeNull();

    const selected = picker.pickFile("token");
    await Promise.resolve();
    pickerCallback({action: "picked", documents: [{id: "selected-file"}]});
    await expect(selected).resolves.toBe("selected-file");
  });
});

describe("Drive REST adapter", () => {
  it("creates with multipart metadata/media and reads validated SB3 bytes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, {id: "created"}))
      .mockResolvedValueOnce(response(200, metadata({
        id: "created",
        version: "1",
        appProperties: {blocksyncSnapshotId: "snapshot-new"},
      })))
      .mockResolvedValueOnce(response(200, metadata()))
      .mockResolvedValueOnce(response(200, validSb3, {"content-length": "4"}));
    const validateSb3 = vi.fn(async () => true);
    const drive = createDriveRestAdapter({
      fetch,
      getAccessToken: () => "token",
      validateSb3,
    });

    const created = await drive.createFile({
      name: "Project.sb3",
      bytes: validSb3,
      snapshot: {
        snapshotId: "snapshot-new",
        leadershipEpoch: "4",
        stateHash: "hash-new",
      },
    });
    const downloaded = await drive.readFile("file-1");

    expect(fetch.mock.calls[0]![0]).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    );
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": expect.stringMatching(
          /^multipart\/related; boundary=/,
        ),
      },
    });
    const createBody = await (fetch.mock.calls[0]![1].body as Blob).text();
    expect(createBody).toContain('"name":"Project.sb3"');
    expect(createBody).toContain('"blocksyncSnapshotId":"snapshot-new"');
    expect(createBody).toContain("Content-Type: application/json; charset=UTF-8");
    expect(createBody).toContain(
      "Content-Type: application/x.scratch.sb3",
    );
    expect(created.fileId).toBe("created");
    expect(downloaded.bytes).toEqual(validSb3);
    expect(validateSb3).toHaveBeenCalledWith(validSb3);
  });

  it("updates only after matching observation and checks attempted snapshot after write", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, metadata()))
      .mockResolvedValueOnce(response(200, {id: "file-1"}))
      .mockResolvedValueOnce(response(200, metadata({
        version: "8",
        appProperties: {blocksyncSnapshotId: "snapshot-2"},
      })));
    const drive = createDriveRestAdapter({
      fetch,
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });

    await drive.updateFile({
      fileId: "file-1",
      bytes: validSb3,
      knownObservation: {version: "7", snapshotId: "snapshot-1"},
      snapshot: {
        snapshotId: "snapshot-2",
        leadershipEpoch: "4",
        stateHash: "hash-2",
      },
    });

    expect(fetch.mock.calls[1]![0]).toBe(
      "https://www.googleapis.com/upload/drive/v3/files/file-1?uploadType=multipart",
    );
    expect(fetch.mock.calls[1]![1].method).toBe("PATCH");
  });

  it("refuses a pre-write observation conflict without uploading", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response(200, metadata({version: "8"})),
    );
    const drive = createDriveRestAdapter({
      fetch,
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });

    await expect(drive.updateFile({
      fileId: "file-1",
      bytes: validSb3,
      knownObservation: {version: "7", snapshotId: "snapshot-1"},
      snapshot: {
        snapshotId: "snapshot-2",
        leadershipEpoch: "4",
        stateHash: "hash-2",
      },
    })).rejects.toBeInstanceOf(DriveConflictError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports post-write mismatch as best-effort conflict detection", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, metadata()))
      .mockResolvedValueOnce(response(200, {id: "file-1"}))
      .mockResolvedValueOnce(response(200, metadata({
        version: "8",
        appProperties: {blocksyncSnapshotId: "other-writer"},
      })));
    const drive = createDriveRestAdapter({
      fetch,
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });

    await expect(drive.updateFile({
      fileId: "file-1",
      bytes: validSb3,
      knownObservation: {version: "7", snapshotId: "snapshot-1"},
      snapshot: {
        snapshotId: "snapshot-2",
        leadershipEpoch: "4",
        stateHash: "hash-2",
      },
    })).rejects.toMatchObject({
      name: "DriveConflictError",
      phase: "post-write",
    });
  });

  it.each([
    [401, {}, DriveAuthenticationError],
    [403, {}, DrivePermissionError],
    [403, {error: {errors: [{reason: "userRateLimitExceeded"}]}}, DriveQuotaError],
    [404, {}, DriveInvalidFileError],
    [429, {}, DriveQuotaError],
    [500, {}, DriveNetworkError],
  ])("maps HTTP %i failures", async (status, body, errorType) => {
    const drive = createDriveRestAdapter({
      fetch: vi.fn(async () => response(status, body)),
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });
    await expect(drive.getMetadata("file-1")).rejects.toBeInstanceOf(errorType);
  });

  it("maps fetch rejection to a network error", async () => {
    const drive = createDriveRestAdapter({
      fetch: vi.fn(async () => {
        throw new TypeError("offline");
      }),
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });
    await expect(drive.getMetadata("file-1")).rejects.toBeInstanceOf(
      DriveNetworkError,
    );
  });

  it("rejects oversized and invalid downloads before returning bytes", async () => {
    const validateSb3 = vi.fn(async () => false);
    const oversizedFetch = vi.fn()
      .mockResolvedValueOnce(response(200, metadata({size: "5242881"})));
    const oversized = createDriveRestAdapter({
      fetch: oversizedFetch,
      getAccessToken: () => "token",
      validateSb3,
    });
    await expect(oversized.readFile("file-1")).rejects.toBeInstanceOf(
      DriveInvalidFileError,
    );
    expect(oversizedFetch).toHaveBeenCalledTimes(1);

    const invalid = createDriveRestAdapter({
      fetch: vi.fn()
        .mockResolvedValueOnce(response(200, metadata()))
        .mockResolvedValueOnce(response(200, validSb3, {"content-length": "4"})),
      getAccessToken: () => "token",
      validateSb3,
    });
    await expect(invalid.readFile("file-1")).rejects.toBeInstanceOf(
      DriveInvalidFileError,
    );
  });
});
