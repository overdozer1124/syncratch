import {
  DriveConflictError,
  DriveSyncError,
  type DriveObservation,
  type DriveRestAdapter,
  type GoogleAuthorization,
  type GooglePicker,
} from "@blocksync/google-drive-sync";

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
  ): Promise<void>;
  persistDriveFileId(fileId: string, localProjectId: string): Promise<void>;
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

  const setStatus = (
    next: EditorDriveStatus,
    message?: string,
  ): void => {
    status = next;
    dependencies.onStatus(next, message);
  };

  const handleError = (error: unknown): false => {
    const next = error instanceof DriveConflictError ? "conflict" : "unsynced";
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
      try {
        await dependencies.auth.connect();
        const current = dependencies.getCurrent();
        if (current.driveFileId) {
          const metadata = await dependencies.drive.getMetadata(
            current.driveFileId,
          );
          observations.set(current.driveFileId, {
            version: metadata.version,
            snapshotId: metadata.snapshotId,
          });
          boundFiles.set(current.localProjectId, current.driveFileId);
        }
        setStatus("connected");
        return true;
      } catch (error) {
        return handleError(error);
      }
    },
    disconnect() {
      dependencies.auth.disconnect();
      observations.clear();
      boundFiles.clear();
      setStatus(dependencies.configured ? "disconnected" : "not-configured");
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
      setStatus("syncing");
      try {
        const fileId = await dependencies.picker.pickFile(accessToken);
        if (fileId === null) {
          setStatus("connected");
          return false;
        }
        const downloaded = await dependencies.drive.readFile(fileId);
        await dependencies.importAsNewLocal(
          downloaded.bytes,
          projectTitle(downloaded.metadata.name),
          fileId,
        );
        observations.set(fileId, {
          version: downloaded.metadata.version,
          snapshotId: downloaded.metadata.snapshotId,
        });
        boundFiles.set(dependencies.getCurrent().localProjectId, fileId);
        setStatus("synced");
        return true;
      } catch (error) {
        return handleError(error);
      }
    },
    async saveToDrive() {
      if (!dependencies.auth.getAccessToken()) {
        setStatus("unsynced", "Connect Google before saving to Drive");
        return false;
      }
      setStatus("syncing");
      try {
        const current = dependencies.getCurrent();
        const fileId = current.driveFileId ??
          boundFiles.get(current.localProjectId);
        const bytes = await dependencies.exportCurrent();
        const snapshot = {
          snapshotId: dependencies.createSnapshotId(),
          // P2P leadership does not exist yet; explicit solo saves use epoch 0.
          leadershipEpoch: "0",
          stateHash: await dependencies.hashBytes(bytes),
        };
        if (!fileId) {
          let created;
          try {
            created = await dependencies.drive.createFile({
              name: `${current.title || "Project"}.sb3`,
              bytes,
              snapshot,
            });
          } catch (error) {
            if (error instanceof DriveSyncError && error.fileId) {
              boundFiles.set(current.localProjectId, error.fileId);
              await dependencies.persistDriveFileId(
                error.fileId,
                current.localProjectId,
              );
            }
            throw error;
          }
          boundFiles.set(current.localProjectId, created.fileId);
          observations.set(created.fileId, created.observation);
          await dependencies.persistDriveFileId(
            created.fileId,
            current.localProjectId,
          );
        } else {
          const knownObservation = observations.get(fileId);
          if (!knownObservation) {
            throw new DriveConflictError(
              "Drive version has not been observed in this session",
              "pre-write",
            );
          }
          const updated = await dependencies.drive.updateFile({
            fileId,
            bytes,
            knownObservation,
            snapshot,
          });
          observations.set(fileId, updated.observation);
        }
        setStatus("synced");
        return true;
      } catch (error) {
        return handleError(error);
      }
    },
  };
}
