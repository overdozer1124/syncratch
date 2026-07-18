import type {LocalProjectRecord} from "@blocksync/project-local-core";
import type {ProjectStore} from "@blocksync/project-store-idb";
import {persistDriveFileLink} from "./drive-file-link.js";

export interface PersistDriveFileIdAndSyncCurrentOptions {
  store: Pick<ProjectStore, "get" | "createOrReplace">;
  driveFileId: string;
  localProjectId: string;
  signal?: AbortSignal;
  getCurrent(): LocalProjectRecord | undefined;
  setCurrent(record: LocalProjectRecord): void;
}

export async function persistDriveFileIdAndSyncCurrent(
  options: PersistDriveFileIdAndSyncCurrentOptions,
): Promise<void> {
  const saved = await persistDriveFileLink(
    options.store,
    options.localProjectId,
    options.driveFileId,
    undefined,
    options.signal,
  );
  const current = options.getCurrent();
  if (
    current?.localProjectId === options.localProjectId &&
    current.revision < saved.revision
  ) {
    options.setCurrent(saved);
  }
  options.signal?.throwIfAborted();
}
