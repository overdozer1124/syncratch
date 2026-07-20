export interface ApplyGuestInitialProjectOptions<T> {
  candidate: T;
  previous?: T;
  isActive(): boolean;
  load(record: T): Promise<void>;
  persist(record: T): Promise<T>;
  remove(record: T): Promise<void>;
  commit(record: T): void;
  setSuppressed(value: boolean): void;
}

export async function applyGuestInitialProject<T>(
  options: ApplyGuestInitialProjectOptions<T>,
): Promise<boolean> {
  options.setSuppressed(true);
  let persisted: T | undefined;

  const restorePrevious = async (): Promise<void> => {
    if (options.previous !== undefined) {
      await options.load(options.previous);
    }
  };
  const rollback = async (): Promise<void> => {
    let cleanupError: unknown;
    let restoreError: unknown;
    if (persisted !== undefined) {
      try {
        await options.remove(persisted);
        persisted = undefined;
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      await restorePrevious();
    } catch (error) {
      restoreError = error;
    }
    if (cleanupError !== undefined && restoreError !== undefined) {
      throw new Error("Guest project rollback and VM restore both failed", {
        cause: {cleanupError, restoreError},
      });
    }
    if (cleanupError !== undefined) throw cleanupError;
    if (restoreError !== undefined) throw restoreError;
  };

  try {
    if (!options.isActive()) return false;
    await options.load(options.candidate);
    if (!options.isActive()) {
      await restorePrevious();
      return false;
    }
    persisted = await options.persist(options.candidate);
    if (!options.isActive()) {
      await rollback();
      return false;
    }
    options.commit(persisted);
    persisted = undefined;
    return true;
  } catch (error) {
    await rollback();
    throw error;
  } finally {
    options.setSuppressed(false);
  }
}
