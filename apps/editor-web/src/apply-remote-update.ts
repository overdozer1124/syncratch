/**
 * Apply a collaborative remote project update to the local VM first, then
 * best-effort persist. IndexedDB failures must not leave the editor stuck on
 * a stale mid-drag block graph while peers already share the finished nest.
 */

export interface ApplyRemoteProjectUpdateOptions<T> {
  candidate: T;
  previous: T;
  isActive(): boolean;
  load(record: T): Promise<void>;
  persist(record: T): Promise<T>;
  commit(record: T, options: {persisted: boolean}): void;
  setSuppressed(value: boolean): void;
  onPersistError?(error: unknown): void;
}

export type ApplyRemoteProjectUpdateResult =
  | {applied: false}
  | {applied: true; persisted: boolean};

export async function applyRemoteProjectUpdate<T>(
  options: ApplyRemoteProjectUpdateOptions<T>,
): Promise<ApplyRemoteProjectUpdateResult> {
  options.setSuppressed(true);
  let loadedCandidate = false;

  const restorePrevious = async (): Promise<void> => {
    await options.load(options.previous);
  };

  try {
    if (!options.isActive()) return {applied: false};

    await options.load(options.candidate);
    loadedCandidate = true;
    if (!options.isActive()) {
      await restorePrevious();
      return {applied: false};
    }

    try {
      const saved = await options.persist(options.candidate);
      if (!options.isActive()) {
        // Session ended after a durable write: keep disk copy, restore VM.
        await restorePrevious();
        return {applied: false};
      }
      options.commit(saved, {persisted: true});
      return {applied: true, persisted: true};
    } catch (error) {
      if (!options.isActive()) {
        await restorePrevious();
        return {applied: false};
      }
      // VM already shows the remote project; keep it and surface save failure.
      options.onPersistError?.(error);
      options.commit(options.candidate, {persisted: false});
      return {applied: true, persisted: false};
    }
  } catch (error) {
    if (loadedCandidate) {
      try {
        await restorePrevious();
      } catch {
        // Prefer the original apply error for the caller.
      }
    }
    throw error;
  } finally {
    options.setSuppressed(false);
  }
}
