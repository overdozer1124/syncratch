import {
  DriveAuthenticationError,
  DriveConflictError,
  DriveFileNotFoundError,
  DriveSyncError,
  type DriveObservation,
  type DriveRestAdapter,
  type GoogleAuthorization,
  type GooglePicker,
} from "@blocksync/google-drive-sync";
import {
  LocalDriveSaveError,
  LocalProjectChangedDuringDriveSaveError,
} from "./drive-export.js";

export type EditorDriveStatus =
  | "not-configured"
  | "disconnected"
  | "connected"
  | "syncing"
  | "synced"
  | "unsynced"
  | "conflict";

export interface CurrentDriveProject {
  localProjectId: string;
  title: string;
  driveFileId?: string;
}

export interface EditorDriveDependencies {
  configured: boolean;
  auth: GoogleAuthorization;
  picker: GooglePicker;
  drive: DriveRestAdapter;
  exportCurrent(): Promise<Uint8Array>;
  getCurrent(): CurrentDriveProject;
  importAsNewLocal(
    bytes: Uint8Array,
    title: string,
    driveFileId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  persistDriveFileId(
    fileId: string,
    localProjectId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  hashBytes(bytes: Uint8Array): Promise<string>;
  createSnapshotId(): string;
  onStatus(status: EditorDriveStatus, message?: string): void;
}

export interface EditorDriveIntegration {
  getStatus(): EditorDriveStatus;
  connect(): Promise<boolean>;
  disconnect(): void;
  openFromDrive(): Promise<boolean>;
  saveToDrive(): Promise<boolean>;
  markLocalChange(): void;
}

function projectTitle(fileName: string): string {
  return fileName.replace(/\.sb3$/i, "") || "Drive project";
}

export function createEditorDriveIntegration(
  dependencies: EditorDriveDependencies,
): EditorDriveIntegration {
  let status: EditorDriveStatus = dependencies.configured
    ? "disconnected"
    : "not-configured";
  const observations = new Map<string, DriveObservation>();
  const boundFiles = new Map<string, string>();
  const pendingCreates = new Set<string>();
  const controllers = new Set<AbortController>();
  let generation = 0;
  let saveInFlight: Promise<boolean> | null = null;

  interface Operation {
    generation: number;
    controller: AbortController;
  }

  const beginOperation = (): Operation => {
    const controller = new AbortController();
    controllers.add(controller);
    return {generation, controller};
  };

  const isActive = (operation: Operation): boolean =>
    operation.generation === generation && !operation.controller.signal.aborted;

  const finishOperation = (operation: Operation): void => {
    controllers.delete(operation.controller);
  };

  const setStatus = (
    next: EditorDriveStatus,
    message?: string,
  ): void => {
    status = next;
    dependencies.onStatus(next, message);
  };

  const disconnectAll = (): void => {
    generation += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    dependencies.auth.disconnect();
    observations.clear();
    boundFiles.clear();
    pendingCreates.clear();
    setStatus(dependencies.configured ? "disconnected" : "not-configured");
  };

  const handleError = (
    error: unknown,
    operationProjectId?: string,
    operation?: Operation,
  ): false => {
    if (operation && !isActive(operation)) return false;
    if (error instanceof DriveAuthenticationError) {
      disconnectAll();
      return false;
    }
    if (
      operationProjectId &&
      dependencies.getCurrent().localProjectId !== operationProjectId
    ) {
      return false;
    }
    const next =
      error instanceof DriveConflictError ||
      (error instanceof LocalDriveSaveError && error.state === "conflict")
        ? "conflict"
        : "unsynced";
    const message = error instanceof DriveSyncError
      ? error.message
      : "Google Drive operation failed";
    setStatus(next, message);
    return false;
  };

  setStatus(status);

  return {
    getStatus() {
      return status;
    },
    async connect() {
      if (!dependencies.configured) return false;
      const operation = beginOperation();
      try {
        await dependencies.auth.connect();
        if (!isActive(operation)) return false;
        const current = dependencies.getCurrent();
        if (current.driveFileId) {
          const bytes = await dependencies.exportCurrent();
          if (!isActive(operation)) return false;
          if (
            dependencies.getCurrent().localProjectId !== current.localProjectId
          ) {
            setStatus("connected");
            return true;
          }
          const localStateHash = await dependencies.hashBytes(bytes);
          if (!isActive(operation)) return false;
          if (
            dependencies.getCurrent().localProjectId !== current.localProjectId
          ) {
            setStatus("connected");
            return true;
          }
          let metadata;
          try {
            metadata = await dependencies.drive.getMetadata(
              current.driveFileId,
              operation.controller.signal,
            );
          } catch (error) {
            if (
              error instanceof DriveFileNotFoundError &&
              isActive(operation)
            ) {
              pendingCreates.add(current.driveFileId);
              boundFiles.set(current.localProjectId, current.driveFileId);
              setStatus("connected");
              return true;
            }
            throw error;
          }
          if (!isActive(operation)) return false;
          if (
            metadata.stateHash === null ||
            metadata.stateHash !== localStateHash
          ) {
            throw new DriveConflictError(
              "Drive content differs from the committed local project; open from Drive to resolve",
              "pre-write",
            );
          }
          observations.set(current.driveFileId, {
            version: metadata.version,
            snapshotId: metadata.snapshotId,
          });
          boundFiles.set(current.localProjectId, current.driveFileId);
        }
        if (!isActive(operation)) return false;
        setStatus("connected");
        return true;
      } catch (error) {
        return handleError(error, undefined, operation);
      } finally {
        finishOperation(operation);
      }
    },
    disconnect() {
      disconnectAll();
    },
    markLocalChange() {
      if (status === "synced") setStatus("unsynced");
    },
    async openFromDrive() {
      const accessToken = dependencies.auth.getAccessToken();
      if (!accessToken) {
        setStatus("unsynced", "Connect Google before opening Drive");
        return false;
      }
      const operation = beginOperation();
      setStatus("syncing");
      try {
        const fileId = await dependencies.picker.pickFile(accessToken);
        if (!isActive(operation)) return false;
        if (fileId === null) {
          setStatus("connected");
          return false;
        }
        const downloaded = await dependencies.drive.readFile(
          fileId,
          operation.controller.signal,
        );
        if (!isActive(operation)) return false;
        await dependencies.importAsNewLocal(
          downloaded.bytes,
          projectTitle(downloaded.metadata.name),
          fileId,
          operation.controller.signal,
        );
        if (!isActive(operation)) return false;
        observations.set(fileId, {
          version: downloaded.metadata.version,
          snapshotId: downloaded.metadata.snapshotId,
        });
        boundFiles.set(dependencies.getCurrent().localProjectId, fileId);
        setStatus("synced");
        return true;
      } catch (error) {
        return handleError(error, undefined, operation);
      } finally {
        finishOperation(operation);
      }
    },
    async saveToDrive() {
      if (saveInFlight) return saveInFlight;
      saveInFlight = (async () => {
        const operation = beginOperation();
        try {
        if (!dependencies.auth.getAccessToken()) {
          setStatus("unsynced", "Connect Google before saving to Drive");
          return false;
        }
        const current = dependencies.getCurrent();
        try {
          const fileId = current.driveFileId ??
            boundFiles.get(current.localProjectId);
          const bytes = await dependencies.exportCurrent();
          if (!isActive(operation)) return false;
          if (
            dependencies.getCurrent().localProjectId !== current.localProjectId
          ) {
            return false;
          }
          const stateHash = await dependencies.hashBytes(bytes);
          if (!isActive(operation)) return false;
          if (
            dependencies.getCurrent().localProjectId !== current.localProjectId
          ) {
            return false;
          }
          const snapshot = {
            snapshotId: dependencies.createSnapshotId(),
            // P2P leadership does not exist yet; explicit solo saves use epoch 0.
            leadershipEpoch: "0",
            stateHash,
          };
          let targetFileId = fileId;
          if (!targetFileId) {
            targetFileId = await dependencies.drive.reserveFileId(
              operation.controller.signal,
            );
            if (!isActive(operation)) return false;
            if (
              dependencies.getCurrent().localProjectId !== current.localProjectId
            ) {
              return false;
            }
            await dependencies.persistDriveFileId(
              targetFileId,
              current.localProjectId,
              operation.controller.signal,
            );
            if (!isActive(operation)) return false;
            if (
              dependencies.getCurrent().localProjectId !== current.localProjectId
            ) {
              return false;
            }
            boundFiles.set(current.localProjectId, targetFileId);
            pendingCreates.add(targetFileId);
          }
          if (pendingCreates.has(targetFileId)) {
            const created = await dependencies.drive.createFile({
                fileId: targetFileId,
                name: `${current.title || "Project"}.sb3`,
                bytes,
                snapshot,
              }, operation.controller.signal);
            if (!isActive(operation)) return false;
            boundFiles.set(current.localProjectId, created.fileId);
            observations.set(created.fileId, created.observation);
            pendingCreates.delete(created.fileId);
          } else {
            const knownObservation = observations.get(targetFileId);
            if (!knownObservation) {
              throw new DriveConflictError(
                "Drive version has not been observed in this session",
                "pre-write",
              );
            }
            const updated = await dependencies.drive.updateFile({
              fileId: targetFileId,
              bytes,
              knownObservation,
              snapshot,
            }, operation.controller.signal);
            if (!isActive(operation)) return false;
            observations.set(targetFileId, updated.observation);
          }
          if (
            dependencies.getCurrent().localProjectId === current.localProjectId
          ) {
            setStatus("synced");
          }
          return true;
        } catch (error) {
          if (error instanceof LocalProjectChangedDuringDriveSaveError) {
            return false;
          }
          return handleError(error, current.localProjectId, operation);
        }
        } finally {
          finishOperation(operation);
        }
      })();
      try {
        return await saveInFlight;
      } finally {
        saveInFlight = null;
      }
    },
  };
}
