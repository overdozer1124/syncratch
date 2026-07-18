import {describe, expect, it, vi} from "vitest";
import "fake-indexeddb/auto";
import {DriveConflictError, DriveNetworkError} from "@blocksync/google-drive-sync";
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
      createFile: vi.fn(async () => ({
        fileId: "created-file",
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

    expect(deps.drive.readFile).toHaveBeenCalledWith("drive-file");
    expect(deps.importAsNewLocal).toHaveBeenCalledWith(
      bytes,
      "Drive project",
      "drive-file",
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
    });
    const integration = createEditorDriveIntegration(deps);

    await integration.connect();
    await integration.saveToDrive();

    expect(deps.drive.getMetadata).toHaveBeenCalledWith("existing-file");
    expect(deps.drive.updateFile).toHaveBeenCalledWith(expect.objectContaining({
      fileId: "existing-file",
      knownObservation: {version: "12", snapshotId: "snapshot-12"},
    }));
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
    expect(deps.persistDriveFileId).toHaveBeenCalledWith(
      "created-file",
      "local-1",
    );
    expect(deps.drive.updateFile).toHaveBeenCalledWith(expect.objectContaining({
      fileId: "created-file",
      knownObservation: {
        version: "1",
        snapshotId: "snapshot-created",
      },
    }));
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
    expect(deps.persistDriveFileId).not.toHaveBeenCalled();
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

  it("records a created file ID after uncertain post-write conflict to avoid duplicates", async () => {
    let driveFileId: string | undefined;
    const conflict = new DriveConflictError(
      "post-write mismatch",
      "post-write",
    );
    conflict.fileId = "created-but-conflicted";
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

    expect(deps.drive.createFile).toHaveBeenCalledTimes(1);
    expect(deps.persistDriveFileId).toHaveBeenCalledWith(
      "created-but-conflicted",
      "local-1",
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
