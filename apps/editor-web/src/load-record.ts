export interface LoadRecordSafelyOptions<T> {
  candidate: T;
  previous?: T;
  load(record: T): Promise<void>;
  commit(record: T): void;
  setSuppressed(value: boolean): void;
}

export async function loadRecordSafely<T>(
  options: LoadRecordSafelyOptions<T>,
): Promise<void> {
  options.setSuppressed(true);
  try {
    await options.load(options.candidate);
    options.commit(options.candidate);
  } catch (error) {
    if (options.previous !== undefined) {
      try {
        await options.load(options.previous);
      } catch {
        // Preserve the original candidate-load error for the caller.
      }
    }
    throw error;
  } finally {
    options.setSuppressed(false);
  }
}
