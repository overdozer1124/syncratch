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

export function isDriveAutosaveEligible(input: {
  driveConnected: boolean;
  collaboration: {
    status: string;
    role: string;
    conflict: boolean;
  } | null;
}): boolean {
  return Boolean(
    input.driveConnected &&
    input.collaboration?.status === "connected" &&
    input.collaboration.role === "leader" &&
    !input.collaboration.conflict
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
