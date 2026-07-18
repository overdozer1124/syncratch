import {describe, expect, it, vi} from "vitest";
import "fake-indexeddb/auto";
import {
  DriveAuthenticationError,
  DriveConflictError,
  DriveFileNotFoundError,
  DriveNetworkError,
} from "@blocksync/google-drive-sync";
import {
  LOCAL_PROJECT_FORMAT,
  type LocalProjectRecord,
} from "@blocksync/project-local-core";
import {openProjectStore} from "@blocksync/project-store-idb";
import {emptyProject} from "@blocksync/project-schema";
import {
  createEditorDriveIntegration,
  type EditorDriveDependencies,
} from "./drive-integration.js";

const bytes = new Uint8Array([80, 75, 3, 4]);

function localRecord(localProjectId: string): LocalProjectRecord {
  return {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId,
    title: localProjectId,
    revision: 0,
    updatedAt: "2026-07-19T00:00:00.000Z",
    document: emptyProject(),
    assets: [],
    saveState: "clean",
  };
}

function dependencies(
  overrides: Partial<EditorDriveDependencies> = {},
): EditorDriveDependencies {
  return {
    configured: true,
    auth: {
      connect: vi.fn(async () => "token"),
      disconnect: vi.fn(),
      getAccessToken: vi.fn(() => "token"),
    },
    picker: {
      pickFile: vi.fn(async () => "drive-file"),
    },
    drive: {
      reserveFileId: vi.fn(async () => "created-file"),
      createFile: vi.fn(async input => ({
        fileId: input.fileId,
        observation: {version: "1", snapshotId: "snapshot-created"},
      })),
      getMetadata: vi.fn(),
      readFile: vi.fn(async () => ({
        bytes,
        metadata: {
          id: "drive-file",
          name: "Drive project.sb3",
          mimeType: "application/x.scratch.sb3",
          size: 4,
          version: "5",
          headRevisionId: "head-5",
          snapshotId: "snapshot-drive",
          leadershipEpoch: "0",
          stateHash: "hash-drive",
          canEdit: true,
          canDownload: true,
        },
      })),
      updateFile: vi.fn(async () => ({
        fileId: "drive-file",
        observation: {version: "6", snapshotId: "snapshot-next"},
      })),
    },
    exportCurrent: vi.fn(async () => bytes),
    getCurrent: vi.fn(() => ({
      localProjectId: "local-1",
      title: "Local",
      driveFileId: undefined,
    })),
    importAsNewLocal: vi.fn(async () => undefined),
    persistDriveFileId: vi.fn(async () => undefined),
    hashBytes: vi.fn(async () => "state-hash"),
    createSnapshotId: vi.fn(() => "snapshot-next"),
    onStatus: vi.fn(),
    ...overrides,
  };
}

describe("editor Drive integration", () => {
  it("reports not configured without loading or contacting Google", async () => {
    const deps = dependencies({configured: false});
    const integration = createEditorDriveIntegration(deps);

    expect(integration.getStatus()).toBe("not-configured");
    await expect(integration.connect()).resolves.toBe(false);
    expect(deps.auth.connect).not.toHaveBeenCalled();
    expect(deps.drive.getMetadata).not.toHaveBeenCalled();
  });

  it("opens a validated Picker-selected file as a new local project", async () => {
    const deps = dependencies();
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    await expect(integration.openFromDrive()).resolves.toBe(true);

    expect(deps.drive.readFile).toHaveBeenCalledWith(
      "drive-file",
      expect.any(AbortSignal),
    );
    expect(deps.importAsNewLocal).toHaveBeenCalledWith(
      bytes,
      "Drive project",
      "drive-file",
      expect.any(AbortSignal),
    );
    expect(integration.getStatus()).toBe("synced");
  });

  it("re-observes an existing Drive-backed project on explicit reconnect", async () => {
    const deps = dependencies({
      getCurrent: vi.fn(() => ({
        localProjectId: "local-1",
        title: "Local",
        driveFileId: "existing-file",
      })),
      drive: {
        ...dependencies().drive,
        getMetadata: vi.fn(async () => ({
          id: "existing-file",
          name: "Local.sb3",
          mimeType: "application/x.scratch.sb3",
          size: 4,
          version: "12",
          headRevisionId: "head-12",
          snapshotId: "snapshot-12",
          leadershipEpoch: "0",
          stateHash: "hash-12",
          canEdit: true,
          canDownload: true,
        })),
      },
      hashBytes: vi.fn(async () => "hash-12"),
    });
    const integration = createEditorDriveIntegration(deps);

    await integration.connect();
    await integration.saveToDrive();

    expect(deps.drive.getMetadata).toHaveBeenCalledWith(
      "existing-file",
      expect.any(AbortSignal),
    );
    expect(deps.drive.updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "existing-file",
        knownObservation: {version: "12", snapshotId: "snapshot-12"},
      }),
      expect.any(AbortSignal),
    );
  });

  it.each([
    ["different", "remote-hash"],
    ["missing", null],
  ])("refuses reconnect baseline when remote state hash is %s", async (
    _label,
    remoteStateHash,
  ) => {
    const deps = dependencies({
      getCurrent: vi.fn(() => ({
        localProjectId: "local-1",
        title: "Local",
        driveFileId: "existing-file",
      })),
      drive: {
        ...dependencies().drive,
        getMetadata: vi.fn(async () => ({
          id: "existing-file",
          name: "Local.sb3",
          mimeType: "application/octet-stream",
          size: 4,
          version: "12",
          headRevisionId: "head-12",
          snapshotId: "snapshot-12",
          leadershipEpoch: "0",
          stateHash: remoteStateHash,
          canEdit: true,
          canDownload: true,
        })),
      },
      hashBytes: vi.fn(async () => "local-hash"),
    });
    const integration = createEditorDriveIntegration(deps);

    await expect(integration.connect()).resolves.toBe(false);
    await expect(integration.saveToDrive()).resolves.toBe(false);

    expect(integration.getStatus()).toBe("conflict");
    expect(deps.drive.updateFile).not.toHaveBeenCalled();
  });

  it("creates first, then updates only the recorded Drive file", async () => {
    let driveFileId: string | undefined;
    const localRecords = new Map([["local-1", {title: "Local"}]]);
    const deps = dependencies({
      getCurrent: vi.fn(() => ({
        localProjectId: "local-1",
        title: "Local",
        driveFileId,
      })),
      persistDriveFileId: vi.fn(async fileId => {
        driveFileId = fileId;
      }),
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    await integration.saveToDrive();
    await integration.saveToDrive();

    expect(deps.drive.createFile).toHaveBeenCalledTimes(1);
    expect(deps.drive.reserveFileId).toHaveBeenCalledTimes(1);
    expect(deps.persistDriveFileId).toHaveBeenCalledWith(
      "created-file",
      "local-1",
      expect.any(AbortSignal),
    );
    expect(deps.drive.createFile).toHaveBeenCalledWith(
      expect.objectContaining({fileId: "created-file"}),
      expect.any(AbortSignal),
    );
    expect(
      (deps.persistDriveFileId as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (deps.drive.createFile as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]!,
    );
    expect(deps.drive.updateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "created-file",
        knownObservation: {
          version: "1",
          snapshotId: "snapshot-created",
        },
      }),
      expect.any(AbortSignal),
    );
    expect(localRecords.get("local-1")).toEqual({title: "Local"});
  });

  it.each([
    [new DriveConflictError("conflict", "pre-write"), "conflict"],
    [new DriveNetworkError("offline"), "unsynced"],
  ] as const)("keeps local actions available after Drive failure", async (
    error,
    status,
  ) => {
    const deps = dependencies({
      drive: {
        ...dependencies().drive,
        createFile: vi.fn(async () => {
          throw error;
        }),
      },
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    await expect(integration.saveToDrive()).resolves.toBe(false);

    expect(integration.getStatus()).toBe(status);
    expect(deps.persistDriveFileId).toHaveBeenCalledWith(
      "created-file",
      "local-1",
      expect.any(AbortSignal),
    );
    await expect(deps.exportCurrent()).resolves.toEqual(bytes);
  });

  it("does not replace local state when Drive download fails", async () => {
    const deps = dependencies({
      drive: {
        ...dependencies().drive,
        readFile: vi.fn(async () => {
          throw new DriveNetworkError("offline");
        }),
      },
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    await expect(integration.openFromDrive()).resolves.toBe(false);

    expect(deps.importAsNewLocal).not.toHaveBeenCalled();
    expect(integration.getStatus()).toBe("unsynced");
  });

  it("does not POST after reserving an ID when durable link persistence fails", async () => {
    const deps = dependencies({
      persistDriveFileId: vi.fn(async () => {
        throw new Error("IndexedDB failed");
      }),
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    await expect(integration.saveToDrive()).resolves.toBe(false);

    expect(deps.drive.reserveFileId).toHaveBeenCalledTimes(1);
    expect(deps.drive.createFile).not.toHaveBeenCalled();
  });

  it("recreates a missing reserved ID after reload without reserving another ID", async () => {
    const deps = dependencies({
      getCurrent: vi.fn(() => ({
        localProjectId: "local-1",
        title: "Local",
        driveFileId: "reserved-before-crash",
      })),
      drive: {
        ...dependencies().drive,
        getMetadata: vi.fn(async () => {
          throw new DriveFileNotFoundError("missing");
        }),
      },
    });
    const integration = createEditorDriveIntegration(deps);

    await expect(integration.connect()).resolves.toBe(true);
    await expect(integration.saveToDrive()).resolves.toBe(true);

    expect(deps.drive.reserveFileId).not.toHaveBeenCalled();
    expect(deps.drive.createFile).toHaveBeenCalledWith(
      expect.objectContaining({fileId: "reserved-before-crash"}),
      expect.any(AbortSignal),
    );
  });

  it("ignores a deferred connect callback after disconnect", async () => {
    let resolveConnect!: (token: string) => void;
    const deps = dependencies({
      auth: {
        connect: vi.fn(() => new Promise<string>(resolve => {
          resolveConnect = resolve;
        })),
        disconnect: vi.fn(),
        getAccessToken: vi.fn(() => null),
      },
    });
    const integration = createEditorDriveIntegration(deps);

    const connecting = integration.connect();
    integration.disconnect();
    resolveConnect("late-token");

    await expect(connecting).resolves.toBe(false);
    expect(integration.getStatus()).toBe("disconnected");
    expect(deps.drive.getMetadata).not.toHaveBeenCalled();
  });

  it("ignores a deferred Picker result after disconnect", async () => {
    let resolvePicker!: (fileId: string) => void;
    const deps = dependencies({
      picker: {
        pickFile: vi.fn(() => new Promise<string | null>(resolve => {
          resolvePicker = resolve;
        })),
      },
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    const opening = integration.openFromDrive();
    integration.disconnect();
    resolvePicker("late-file");

    await expect(opening).resolves.toBe(false);
    expect(integration.getStatus()).toBe("disconnected");
    expect(deps.drive.readFile).not.toHaveBeenCalled();
    expect(deps.importAsNewLocal).not.toHaveBeenCalled();
  });

  it("aborts after reserve on disconnect without linking or creating", async () => {
    let resolveReserve!: (fileId: string) => void;
    let reserveSignal: AbortSignal | undefined;
    const deps = dependencies({
      drive: {
        ...dependencies().drive,
        reserveFileId: vi.fn(signal => {
          reserveSignal = signal;
          return new Promise<string>(resolve => {
            resolveReserve = resolve;
          });
        }),
      },
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    const saving = integration.saveToDrive();
    await vi.waitFor(() => expect(deps.drive.reserveFileId).toHaveBeenCalled());
    integration.disconnect();
    resolveReserve("late-reserved-id");

    await expect(saving).resolves.toBe(false);
    expect(reserveSignal?.aborted).toBe(true);
    expect(deps.persistDriveFileId).not.toHaveBeenCalled();
    expect(deps.drive.createFile).not.toHaveBeenCalled();
    expect(integration.getStatus()).toBe("disconnected");
  });

  it("aborts an in-flight create after the reserved ID is durable", async () => {
    let createSignal: AbortSignal | undefined;
    const deps = dependencies({
      drive: {
        ...dependencies().drive,
        createFile: vi.fn((_input, signal) => {
          createSignal = signal;
          return new Promise<never>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            }, {once: true});
          });
        }),
      },
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    const saving = integration.saveToDrive();
    await vi.waitFor(() => expect(deps.drive.createFile).toHaveBeenCalled());
    integration.disconnect();

    await expect(saving).resolves.toBe(false);
    expect(createSignal?.aborted).toBe(true);
    expect(deps.persistDriveFileId).toHaveBeenCalledWith(
      "created-file",
      "local-1",
      expect.any(AbortSignal),
    );
    expect(integration.getStatus()).toBe("disconnected");
  });

  it.each([
    [new Error("IndexedDB failed"), "unsynced"],
    [new DriveConflictError("stale local revision", "pre-write"), "conflict"],
  ] as const)("does not upload when local flush/export fails", async (
    error,
    expectedStatus,
  ) => {
    const deps = dependencies({
      exportCurrent: vi.fn(async () => {
        throw error;
      }),
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    await expect(integration.saveToDrive()).resolves.toBe(false);

    expect(integration.getStatus()).toBe(expectedStatus);
    expect(deps.drive.createFile).not.toHaveBeenCalled();
    expect(deps.drive.updateFile).not.toHaveBeenCalled();
  });

  it("disconnects and clears authentication after a Drive auth failure", async () => {
    const deps = dependencies({
      drive: {
        ...dependencies().drive,
        createFile: vi.fn(async () => {
          throw new DriveAuthenticationError("expired");
        }),
      },
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    await integration.saveToDrive();

    expect(deps.auth.disconnect).toHaveBeenCalled();
    expect(integration.getStatus()).toBe("disconnected");
  });

  it("aborts before upload when the active project changes during export", async () => {
    let activeProjectId = "local-1";
    const onStatus = vi.fn();
    const deps = dependencies({
      getCurrent: vi.fn(() => ({
        localProjectId: activeProjectId,
        title: "Local",
        driveFileId: undefined,
      })),
      exportCurrent: vi.fn(async () => {
        activeProjectId = "local-2";
        return bytes;
      }),
      onStatus,
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();
    onStatus.mockClear();

    await expect(integration.saveToDrive()).resolves.toBe(false);

    expect(deps.drive.createFile).not.toHaveBeenCalled();
    expect(deps.drive.updateFile).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("shares one in-flight save so concurrent clicks cannot create duplicates", async () => {
    let releaseExport!: () => void;
    const exportPending = new Promise<void>(resolve => {
      releaseExport = resolve;
    });
    const deps = dependencies({
      exportCurrent: vi.fn(async () => {
        await exportPending;
        return bytes;
      }),
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    const first = integration.saveToDrive();
    const second = integration.saveToDrive();
    releaseExport();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(deps.exportCurrent).toHaveBeenCalledTimes(1);
    expect(deps.drive.createFile).toHaveBeenCalledTimes(1);
  });

  it("retries an uncertain create only with the same durable reserved ID", async () => {
    let driveFileId: string | undefined;
    const conflict = new DriveConflictError(
      "post-write mismatch",
      "post-write",
    );
    conflict.fileId = "created-file";
    const deps = dependencies({
      getCurrent: vi.fn(() => ({
        localProjectId: "local-1",
        title: "Local",
        driveFileId,
      })),
      persistDriveFileId: vi.fn(async fileId => {
        driveFileId = fileId;
      }),
      drive: {
        ...dependencies().drive,
        createFile: vi.fn(async () => {
          throw conflict;
        }),
      },
    });
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();

    await integration.saveToDrive();
    await integration.saveToDrive();

    expect(deps.drive.createFile).toHaveBeenCalledTimes(2);
    expect(deps.drive.reserveFileId).toHaveBeenCalledTimes(1);
    for (const call of (deps.drive.createFile as ReturnType<typeof vi.fn>).mock
      .calls) {
      expect(call[0].fileId).toBe("created-file");
    }
    expect(deps.persistDriveFileId).toHaveBeenCalledWith(
      "created-file",
      "local-1",
      expect.any(AbortSignal),
    );
    expect(deps.drive.updateFile).not.toHaveBeenCalled();
  });

  it("marks a synced Drive-backed project unsynced after a local change", async () => {
    const deps = dependencies();
    const integration = createEditorDriveIntegration(deps);
    await integration.connect();
    await integration.openFromDrive();

    integration.markLocalChange();

    expect(integration.getStatus()).toBe("unsynced");
  });

  it("preserves IndexedDB records through successful create, update, and open", async () => {
    const databaseName = `drive-integration-${crypto.randomUUID()}`;
    const store = await openProjectStore({databaseName});
    await store.createOrReplace(localRecord("local-1"), null);
    await store.createOrReplace(localRecord("unrelated"), null);
    let driveFileId: string | undefined;
    const deps = dependencies({
      getCurrent: vi.fn(() => ({
        localProjectId: "local-1",
        title: "Local",
        driveFileId,
      })),
      persistDriveFileId: vi.fn(async (fileId, localProjectId) => {
        const existing = await store.get(localProjectId);
        await store.createOrReplace({
          ...existing,
          driveFileId: fileId,
          revision: existing.revision + 1,
        }, existing.revision);
        driveFileId = fileId;
      }),
      importAsNewLocal: vi.fn(async (_bytes, title, fileId) => {
        await store.createOrReplace({
          ...localRecord("imported"),
          title,
          driveFileId: fileId,
        }, null);
      }),
    });
    const integration = createEditorDriveIntegration(deps);

    await integration.connect();
    await integration.saveToDrive();
    await integration.saveToDrive();
    await integration.openFromDrive();

    expect((await store.get("local-1")).driveFileId).toBe("created-file");
    expect((await store.get("unrelated")).title).toBe("unrelated");
    expect((await store.get("imported")).driveFileId).toBe("drive-file");
    expect(await store.list()).toHaveLength(3);
    store.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
});
