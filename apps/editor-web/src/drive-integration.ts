import {
  DriveAuthenticationError,
  DriveConflictError,
  DriveFileNotFoundError,
  DrivePermissionError,
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
  /**
   * Current leadership epoch to stamp on Drive snapshots. Solo/local operation
   * returns "0"; in a collaboration room this is the deterministic epoch derived
   * from the room id, leader, and eligible membership.
   */
  getLeadershipEpoch?(): string;
  /**
   * Gate that decides whether this peer may perform a durable Drive snapshot.
   * Only the current room leader may write; solo operation always may. When it
   * returns not-ok the save is refused without claiming remote save success.
   */
  canPersistToDrive?(options?: {explicit?: boolean}): {
    ok: boolean;
    reason?: string;
  };
}

export interface EditorDriveIntegration {
  getStatus(): EditorDriveStatus;
  isConnected(): boolean;
  connect(): Promise<boolean>;
  tryRestoreSession(): Promise<boolean>;
  disconnect(): void;
  openFromDrive(): Promise<boolean>;
  openCollaborationFile(fileId: string): Promise<boolean>;
  reobserveCurrentFile(): Promise<boolean>;
  saveToDrive(options?: {explicit?: boolean}): Promise<boolean>;
  markLocalChange(): void;
}

function projectTitle(fileName: string): string {
  return fileName.replace(/\.sb3$/i, "") || "Drive project";
}

interface TrackedObservation extends DriveObservation {
  contentHash: string;
}

export function createEditorDriveIntegration(
  dependencies: EditorDriveDependencies,
): EditorDriveIntegration {
  let status: EditorDriveStatus = dependencies.configured
    ? "disconnected"
    : "not-configured";
  const observations = new Map<string, TrackedObservation>();
  const boundFiles = new Map<string, string>();
  const pendingCreates = new Set<string>();
  const controllers = new Set<AbortController>();
  let generation = 0;
  let saveInFlight: {
    generation: number;
    promise: Promise<boolean>;
  } | null = null;

  const trackObservation = (
    fileId: string,
    observation: DriveObservation,
    contentHash: string,
  ): TrackedObservation => {
    const tracked = {
      version: observation.version,
      snapshotId: observation.snapshotId,
      contentHash,
    };
    observations.set(fileId, tracked);
    return tracked;
  };

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
    isConnected() {
      return dependencies.auth.getAccessToken() !== null;
    },
    async tryRestoreSession() {
      if (!dependencies.configured) return false;
      if (!dependencies.auth.canRestoreSession()) return false;
      return this.connect();
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
          if (metadata.stateHash !== localStateHash) {
            if (metadata.stateHash !== null) {
              throw new DriveConflictError(
                "Drive content differs from the committed local project; open from Drive to resolve",
                "pre-write",
              );
            }
            const downloaded = await dependencies.drive.readFile(
              current.driveFileId,
              operation.controller.signal,
            );
            if (!isActive(operation)) return false;
            const remoteHash = await dependencies.hashBytes(downloaded.bytes);
            if (!isActive(operation)) return false;
            if (remoteHash !== localStateHash) {
              throw new DriveConflictError(
                "Drive content differs from the committed local project; open from Drive to resolve",
                "pre-write",
              );
            }
          }
          trackObservation(
            current.driveFileId,
            metadata,
            localStateHash,
          );
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
        const contentHash = await dependencies.hashBytes(downloaded.bytes);
        if (!isActive(operation)) return false;
        // Re-read metadata after Picker/download; Drive may bump version when
        // drive.file access is granted without changing file bytes.
        const fresh = await dependencies.drive.getMetadata(
          fileId,
          operation.controller.signal,
        );
        if (!isActive(operation)) return false;
        trackObservation(fileId, fresh, contentHash);
        boundFiles.set(dependencies.getCurrent().localProjectId, fileId);
        setStatus("synced");
        return true;
      } catch (error) {
        return handleError(error, undefined, operation);
      } finally {
        finishOperation(operation);
      }
    },
    async openCollaborationFile(fileId) {
      const accessToken = dependencies.auth.getAccessToken();
      if (!accessToken) {
        setStatus("unsynced", "Connect Google before joining a room");
        return false;
      }
      const operation = beginOperation();
      setStatus("syncing");
      try {
        // drive.file scope cannot read an arbitrary shared fileId until this
        // Google account has opened that file with this app (Picker). Try the
        // invite id first; on not-found/permission, require an explicit pick of
        // the same file so the app becomes authorized for it.
        let downloaded: Awaited<
          ReturnType<DriveRestAdapter["readFile"]>
        >;
        try {
          downloaded = await dependencies.drive.readFile(
            fileId,
            operation.controller.signal,
          );
        } catch (error) {
          if (
            !(error instanceof DriveFileNotFoundError) &&
            !(error instanceof DrivePermissionError)
          ) {
            throw error;
          }
          setStatus(
            "syncing",
            "Pick the Drive file the host shared with this Google account",
          );
          const pickedId = await dependencies.picker.pickFile(accessToken, {
            fileIds: [fileId],
          });
          if (!isActive(operation)) return false;
          if (pickedId === null) {
            setStatus(
              "unsynced",
              "Join cancelled. Share the host file, then Join and pick it",
            );
            return false;
          }
          if (pickedId !== fileId) {
            setStatus(
              "unsynced",
              "Wrong Drive file selected. Pick the same file the host shared",
            );
            return false;
          }
          downloaded = await dependencies.drive.readFile(
            fileId,
            operation.controller.signal,
          );
        }
        if (!isActive(operation)) return false;
        await dependencies.importAsNewLocal(
          downloaded.bytes,
          projectTitle(downloaded.metadata.name),
          fileId,
          operation.controller.signal,
        );
        if (!isActive(operation)) return false;
        const contentHash = await dependencies.hashBytes(downloaded.bytes);
        if (!isActive(operation)) return false;
        const fresh = await dependencies.drive.getMetadata(
          fileId,
          operation.controller.signal,
        );
        if (!isActive(operation)) return false;
        trackObservation(fileId, fresh, contentHash);
        boundFiles.set(dependencies.getCurrent().localProjectId, fileId);
        setStatus("synced");
        return true;
      } catch (error) {
        return handleError(error, undefined, operation);
      } finally {
        finishOperation(operation);
      }
    },
    async reobserveCurrentFile() {
      if (!dependencies.auth.getAccessToken()) return false;
      const current = dependencies.getCurrent();
      if (!current.driveFileId) return false;
      const operation = beginOperation();
      try {
        const [bytes, metadata, downloaded] = await Promise.all([
          dependencies.exportCurrent(),
          dependencies.drive.getMetadata(
            current.driveFileId,
            operation.controller.signal,
          ),
          dependencies.drive.readFile(
            current.driveFileId,
            operation.controller.signal,
          ),
        ]);
        if (!isActive(operation)) return false;
        if (dependencies.getCurrent().localProjectId !== current.localProjectId) {
          return false;
        }
        const [localHash, remoteHash] = await Promise.all([
          dependencies.hashBytes(bytes),
          dependencies.hashBytes(downloaded.bytes),
        ]);
        if (!isActive(operation)) return false;
        // Content must match Drive. App-property stateHash may be null/stale
        // (Chromebook upload, older saves) even when bytes match — do not
        // treat that as a conflict.
        if (localHash !== remoteHash) {
          setStatus(
            "unsynced",
            "Local project differs from Drive; save before collaborating",
          );
          return false;
        }
        trackObservation(current.driveFileId, metadata, localHash);
        boundFiles.set(current.localProjectId, current.driveFileId);
        return true;
      } catch (error) {
        return handleError(error, current.localProjectId, operation);
      } finally {
        finishOperation(operation);
      }
    },
    async saveToDrive(saveOptions) {
      if (saveInFlight?.generation === generation) {
        return saveInFlight.promise;
      }
      const entryGeneration = generation;
      const promise = (async () => {
        const operation = beginOperation();
        try {
        if (!dependencies.auth.getAccessToken()) {
          setStatus("unsynced", "Connect Google before saving to Drive");
          return false;
        }
        const writeGate = dependencies.canPersistToDrive?.({
          explicit: saveOptions?.explicit === true,
        });
        if (writeGate && !writeGate.ok) {
          setStatus(
            "unsynced",
            writeGate.reason ?? "Only the room leader saves to Drive",
          );
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
            // Solo/local operation stamps epoch "0"; in a room this is the
            // deterministic leadership epoch supplied by the collaboration layer.
            leadershipEpoch: dependencies.getLeadershipEpoch?.() ?? "0",
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
            trackObservation(
              created.fileId,
              created.observation,
              stateHash,
            );
            pendingCreates.delete(created.fileId);
          } else {
            let knownObservation = observations.get(targetFileId);
            const latest = await dependencies.drive.getMetadata(
              targetFileId,
              operation.controller.signal,
            );
            if (!isActive(operation)) return false;
            if (!knownObservation) {
              // Reload/HMR drops in-memory observations while IndexedDB still
              // has driveFileId. Re-baseline from Drive, then save local edits.
              if (latest.stateHash === stateHash) {
                trackObservation(targetFileId, latest, stateHash);
                setStatus("synced");
                return true;
              }
              const remote = await dependencies.drive.readFile(
                targetFileId,
                operation.controller.signal,
              );
              if (!isActive(operation)) return false;
              const remoteHash = await dependencies.hashBytes(remote.bytes);
              if (!isActive(operation)) return false;
              if (remoteHash === stateHash) {
                trackObservation(targetFileId, latest, stateHash);
                setStatus("synced");
                return true;
              }
              knownObservation = trackObservation(
                targetFileId,
                latest,
                remoteHash,
              );
            } else if (
              latest.version !== knownObservation.version ||
              latest.snapshotId !== knownObservation.snapshotId
            ) {
              if (latest.stateHash === stateHash) {
                trackObservation(targetFileId, latest, stateHash);
                setStatus("synced");
                return true;
              }
              const remote = await dependencies.drive.readFile(
                targetFileId,
                operation.controller.signal,
              );
              if (!isActive(operation)) return false;
              const remoteHash = await dependencies.hashBytes(remote.bytes);
              if (!isActive(operation)) return false;
              if (remoteHash === stateHash) {
                trackObservation(targetFileId, latest, stateHash);
                setStatus("synced");
                return true;
              }
              if (remoteHash !== knownObservation.contentHash) {
                throw new DriveConflictError(
                  "Drive file differs from the last observed version",
                  "pre-write",
                );
              }
              // Metadata-only drift (e.g. Picker grant); keep writing local edits.
              knownObservation = trackObservation(
                targetFileId,
                latest,
                knownObservation.contentHash,
              );
            }
            const updated = await dependencies.drive.updateFile({
              fileId: targetFileId,
              bytes,
              knownObservation: {
                version: knownObservation.version,
                snapshotId: knownObservation.snapshotId,
              },
              snapshot,
            }, operation.controller.signal);
            if (!isActive(operation)) return false;
            trackObservation(targetFileId, updated.observation, stateHash);
          }
          if (
            isActive(operation) &&
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
      const entry = {generation: entryGeneration, promise};
      saveInFlight = entry;
      try {
        return await promise;
      } finally {
        if (saveInFlight === entry) saveInFlight = null;
      }
    },
  };
}
