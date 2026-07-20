export interface DriveAutosave {
  noteChange(): void;
  eligibilityChanged(): void;
  cancel(): void;
}

export interface DriveAutosaveOptions {
  delayMs: number;
  isEligible(): boolean;
  save(): Promise<boolean>;
}

/**
 * Background Drive autosave eligibility (stage-1 creator-only gate).
 * Explicit first backup is authorized separately via canPersistToDrive({explicit:true})
 * and does not require a persisted file id.
 */
export function isDriveAutosaveEligible(input: {
  driveConnected: boolean;
  createdThisRoom: boolean;
  bootstrapReady: boolean;
  driveFileId: string | undefined;
  collaborationConnected: boolean;
  conflict: boolean;
}): boolean {
  return Boolean(
    input.driveConnected &&
    input.createdThisRoom &&
    input.bootstrapReady &&
    input.driveFileId &&
    input.collaborationConnected &&
    !input.conflict
  );
}

export function createDriveAutosave(
  options: DriveAutosaveOptions,
): DriveAutosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saveInFlight: Promise<boolean> | null = null;
  let changedDuringSave = false;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!options.isEligible()) return;

      const save = options.save();
      saveInFlight = save;
      void save.catch(() => false).finally(() => {
        if (saveInFlight !== save) return;
        saveInFlight = null;
        if (!changedDuringSave) return;
        changedDuringSave = false;
        if (options.isEligible()) schedule();
      });
    }, options.delayMs);
  };

  return {
    noteChange() {
      if (!options.isEligible()) return;
      if (saveInFlight) {
        changedDuringSave = true;
        return;
      }
      schedule();
    },
    eligibilityChanged() {
      if (!options.isEligible()) {
        clearTimer();
        changedDuringSave = false;
      }
    },
    cancel() {
      clearTimer();
      changedDuringSave = false;
    },
  };
}
