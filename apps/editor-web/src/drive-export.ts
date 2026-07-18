import type {LocalSaveState} from "./save-coordinator.js";

export class LocalDriveSaveError extends Error {
  constructor(readonly state: Exclude<LocalSaveState, "clean">) {
    super(`Local project is not committed (${state})`);
    this.name = "LocalDriveSaveError";
  }
}

export class LocalProjectChangedDuringDriveSaveError extends Error {
  constructor() {
    super("Active project changed during Drive save");
    this.name = "LocalProjectChangedDuringDriveSaveError";
  }
}

export interface CommittedDriveExportOptions {
  localProjectId: string;
  flush(): Promise<void>;
  getSaveState(): LocalSaveState;
  getCurrentProjectId(): string;
  exportCommitted(): Promise<Uint8Array>;
}

export async function prepareCommittedDriveExport(
  options: CommittedDriveExportOptions,
): Promise<Uint8Array> {
  await options.flush();
  const stateAfterFlush = options.getSaveState();
  if (stateAfterFlush !== "clean") {
    throw new LocalDriveSaveError(stateAfterFlush);
  }
  if (options.getCurrentProjectId() !== options.localProjectId) {
    throw new LocalProjectChangedDuringDriveSaveError();
  }
  const bytes = await options.exportCommitted();
  const stateAfterExport = options.getSaveState();
  if (stateAfterExport !== "clean") {
    throw new LocalDriveSaveError(stateAfterExport);
  }
  if (options.getCurrentProjectId() !== options.localProjectId) {
    throw new LocalProjectChangedDuringDriveSaveError();
  }
  return bytes;
}
