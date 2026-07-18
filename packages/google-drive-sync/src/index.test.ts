import {describe, expect, it, vi} from "vitest";
import {
  DRIVE_FILE_SCOPE,
  DriveAuthenticationError,
  DriveConflictError,
  DriveFileNotFoundError,
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

  it("shares one in-flight token request across concurrent connects", async () => {
    let callback: (value: {access_token?: string; error?: string}) => void =
      () => undefined;
    const requestAccessToken = vi.fn();
    const initTokenClient = vi.fn(config => {
      callback = config.callback;
      return {requestAccessToken};
    });
    const auth = createGoogleAuthorization({
      clientId: "client-id",
      loadScripts: async () => undefined,
      getGoogle: () => ({
        accounts: {oauth2: {initTokenClient}},
      }),
    });

    const first = auth.connect();
    const second = auth.connect();
    await Promise.resolve();
    callback({access_token: "shared-token"});

    await expect(Promise.all([first, second])).resolves.toEqual([
      "shared-token",
      "shared-token",
    ]);
    expect(initTokenClient).toHaveBeenCalledTimes(1);
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
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
      .mockResolvedValueOnce(response(200, {
        ids: ["reserved-id"],
        space: "drive",
        kind: "drive#generatedIds",
      }))
      .mockResolvedValueOnce(response(200, {id: "reserved-id"}))
      .mockResolvedValueOnce(response(200, metadata({
        id: "reserved-id",
        version: "1",
        appProperties: {blocksyncSnapshotId: "snapshot-new"},
      })))
      .mockResolvedValueOnce(response(200, metadata({
        mimeType: "application/octet-stream",
      })))
      .mockResolvedValueOnce(response(200, validSb3, {"content-length": "4"}));
    const validateSb3 = vi.fn(async () => true);
    const drive = createDriveRestAdapter({
      fetch,
      getAccessToken: () => "token",
      validateSb3,
    });
    const signal = new AbortController().signal;

    const reservedFileId = await drive.reserveFileId(signal);
    const created = await drive.createFile({
      fileId: reservedFileId,
      name: "Project.sb3",
      bytes: validSb3,
      snapshot: {
        snapshotId: "snapshot-new",
        leadershipEpoch: "4",
        stateHash: "hash-new",
      },
    }, signal);
    const downloaded = await drive.readFile("file-1", signal);

    expect(fetch.mock.calls[0]![0]).toBe(
      "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files",
    );
    expect(fetch.mock.calls[1]![0]).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    );
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": expect.stringMatching(
          /^multipart\/related; boundary=/,
        ),
      },
    });
    const createBody = await (fetch.mock.calls[1]![1].body as Blob).text();
    expect(createBody).toContain('"id":"reserved-id"');
    expect(createBody).toContain('"name":"Project.sb3"');
    expect(createBody).toContain('"blocksyncSnapshotId":"snapshot-new"');
    expect(createBody).toContain("Content-Type: application/json; charset=UTF-8");
    expect(createBody).toContain(
      "Content-Type: application/x.scratch.sb3",
    );
    expect(created.fileId).toBe("reserved-id");
    expect(downloaded.bytes).toEqual(validSb3);
    expect(validateSb3).toHaveBeenCalledWith(validSb3);
    expect(fetch.mock.calls.every(call => call[1]?.signal === signal)).toBe(true);
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
    const signal = new AbortController().signal;

    await drive.updateFile({
      fileId: "file-1",
      bytes: validSb3,
      knownObservation: {version: "7", snapshotId: "snapshot-1"},
      snapshot: {
        snapshotId: "snapshot-2",
        leadershipEpoch: "4",
        stateHash: "hash-2",
      },
    }, signal);

    expect(fetch.mock.calls[1]![0]).toBe(
      "https://www.googleapis.com/upload/drive/v3/files/file-1?uploadType=multipart&supportsAllDrives=true",
    );
    expect(fetch.mock.calls[1]![1].method).toBe("PATCH");
    expect(fetch.mock.calls.every(call => call[1]?.signal === signal)).toBe(true);
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
    ["POST", response(500, {})],
    ["JSON", response(200, {})],
  ])("attaches a reserved file ID when create %s fails", async (
    _phase,
    createResponse,
  ) => {
    const fetch = vi.fn().mockResolvedValueOnce(createResponse);
    const drive = createDriveRestAdapter({
      fetch,
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });

    await expect(drive.createFile({
      fileId: "reserved-id",
      name: "Project.sb3",
      bytes: validSb3,
      snapshot: {
        snapshotId: "snapshot-new",
        leadershipEpoch: "0",
        stateHash: "hash-new",
      },
    })).rejects.toMatchObject({fileId: "reserved-id"});
  });

  it("attaches the reserved file ID when create confirmation fails", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, {id: "reserved-id"}))
      .mockResolvedValueOnce(response(200, metadata({
        id: "reserved-id",
        appProperties: {blocksyncSnapshotId: "other"},
      })));
    const drive = createDriveRestAdapter({
      fetch,
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });

    await expect(drive.createFile({
      fileId: "reserved-id",
      name: "Project.sb3",
      bytes: validSb3,
      snapshot: {
        snapshotId: "snapshot-new",
        leadershipEpoch: "0",
        stateHash: "hash-new",
      },
    })).rejects.toMatchObject({
      fileId: "reserved-id",
      phase: "post-write",
    });
  });

  it.each([
    [401, {}, DriveAuthenticationError],
    [403, {}, DrivePermissionError],
    [403, {error: {errors: [{reason: "userRateLimitExceeded"}]}}, DriveQuotaError],
    [404, {}, DriveFileNotFoundError],
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

  it("cancels a download stream immediately after the cap is exceeded", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel: cancelled,
    });
    const download = new Response(body, {
      headers: {"content-length": "1"},
    });
    const arrayBuffer = vi.spyOn(download, "arrayBuffer");
    const drive = createDriveRestAdapter({
      fetch: vi.fn()
        .mockResolvedValueOnce(response(200, metadata({size: "4"})))
        .mockResolvedValueOnce(download),
      getAccessToken: () => "token",
      validateSb3: async () => true,
      maxBytes: 4,
    });

    await expect(drive.readFile("file-1")).rejects.toBeInstanceOf(
      DriveInvalidFileError,
    );
    expect(cancelled).toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects download responses without a readable body", async () => {
    const download = response(200, validSb3);
    Object.defineProperty(download, "body", {value: null});
    const arrayBuffer = vi.spyOn(download, "arrayBuffer");
    const drive = createDriveRestAdapter({
      fetch: vi.fn()
        .mockResolvedValueOnce(response(200, metadata()))
        .mockResolvedValueOnce(download),
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });

    await expect(drive.readFile("file-1")).rejects.toBeInstanceOf(
      DriveInvalidFileError,
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("cancels an in-flight download stream when its signal aborts", async () => {
    let secondReadStarted!: () => void;
    const firstChunkReady = new Promise<void>(resolve => {
      secondReadStarted = resolve;
    });
    let finishRead!: (value: {done: true; value?: undefined}) => void;
    const pendingRead = new Promise<{done: true; value?: undefined}>(resolve => {
      finishRead = resolve;
    });
    const cancelled = vi.fn(async () => {
      finishRead({done: true});
    });
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new Uint8Array([1]),
        })
        .mockImplementationOnce(() => {
          secondReadStarted();
          return pendingRead;
        }),
      cancel: cancelled,
    };
    const download = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {getReader: () => reader},
    } as unknown as Response;
    const controller = new AbortController();
    const drive = createDriveRestAdapter({
      fetch: vi.fn()
        .mockResolvedValueOnce(response(200, metadata({size: "4"})))
        .mockResolvedValueOnce(download),
      getAccessToken: () => "token",
      validateSb3: async () => true,
    });

    const reading = drive.readFile("file-1", controller.signal);
    await firstChunkReady;
    controller.abort();

    await expect(reading).rejects.toMatchObject({name: "AbortError"});
    expect(cancelled).toHaveBeenCalled();
  });
});
