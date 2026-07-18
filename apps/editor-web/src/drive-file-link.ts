import type {LocalProjectRecord} from "@blocksync/project-local-core";
import {
  ProjectStoreRevisionConflictError,
  type ProjectStore,
} from "@blocksync/project-store-idb";

type DriveFileLinkStore = Pick<ProjectStore, "get" | "createOrReplace">;

export async function persistDriveFileLink(
  store: DriveFileLinkStore,
  localProjectId: string,
  driveFileId: string,
  now: () => string = () => new Date().toISOString(),
  signal?: AbortSignal,
): Promise<LocalProjectRecord> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted();
    const record = await store.get(localProjectId);
    signal?.throwIfAborted();
    if (record.driveFileId === driveFileId) return record;
    const next: LocalProjectRecord = {
      ...record,
      driveFileId,
      revision: record.revision + 1,
      updatedAt: now(),
    };
    try {
      signal?.throwIfAborted();
      return await store.createOrReplace(next, record.revision);
    } catch (error) {
      if (!(error instanceof ProjectStoreRevisionConflictError)) throw error;
    }
  }
  throw new ProjectStoreRevisionConflictError(null, null);
}
