import {
  validateLocalProjectRecord,
  type LocalProjectRecord,
} from "@blocksync/project-local-core";

export const PROJECT_STORE_DATABASE_NAME = "blocksync-projects";
export const PROJECT_STORE_DATABASE_VERSION = 1;
export const PROJECTS_OBJECT_STORE = "projects";

type ErrorCode =
  | "NOT_FOUND"
  | "STALE_REVISION"
  | "INVALID_RECORD"
  | "TRANSACTION_FAILED"
  | "QUOTA_EXCEEDED";

export class ProjectStoreError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ProjectStoreNotFoundError extends ProjectStoreError {
  constructor(localProjectId: string) {
    super("NOT_FOUND", `Local project ${localProjectId} was not found`);
  }
}

export class ProjectStoreRevisionConflictError extends ProjectStoreError {
  readonly expectedRevision: number | null;
  readonly actualRevision: number | null;

  constructor(expectedRevision: number | null, actualRevision: number | null) {
    super(
      "STALE_REVISION",
      `Expected revision ${String(expectedRevision)}, found ${String(actualRevision)}`,
    );
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class ProjectStoreInvalidRecordError extends ProjectStoreError {
  constructor(message: string) {
    super("INVALID_RECORD", message);
  }
}

export class ProjectStoreTransactionError extends ProjectStoreError {
  constructor(message: string, cause?: unknown) {
    super("TRANSACTION_FAILED", message, {cause});
  }
}

export class ProjectStoreQuotaError extends ProjectStoreError {
  constructor(cause?: unknown) {
    super("QUOTA_EXCEEDED", "IndexedDB quota exceeded", {cause});
  }
}

export interface OpenProjectStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
}

export interface ProjectStore {
  get(localProjectId: string): Promise<LocalProjectRecord>;
  list(): Promise<LocalProjectRecord[]>;
  createOrReplace(
    record: LocalProjectRecord,
    expectedRevision: number | null,
  ): Promise<LocalProjectRecord>;
  delete(localProjectId: string): Promise<void>;
  close(): void;
}

function cloneRecord(record: LocalProjectRecord): LocalProjectRecord {
  return structuredClone(record);
}

function assertValidRecord(candidate: unknown): LocalProjectRecord {
  const result = validateLocalProjectRecord(candidate);
  if (!result.ok) {
    throw new ProjectStoreInvalidRecordError(
      result.issues.map(issue => issue.message).join("; "),
    );
  }
  return result.value;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new DOMException("IndexedDB transaction aborted", "AbortError"),
      );
    transaction.onerror = () => {
      // The abort event supplies the final transaction outcome.
    };
  });
}

function mapWriteError(error: unknown): ProjectStoreError {
  if (error instanceof ProjectStoreError) return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new ProjectStoreQuotaError(error);
  }
  return new ProjectStoreTransactionError(
    error instanceof Error ? error.message : "IndexedDB transaction failed",
    error,
  );
}

function abortIfActive(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // A completed or already aborted transaction needs no further action.
  }
}

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, PROJECT_STORE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECTS_OBJECT_STORE)) {
        database.createObjectStore(PROJECTS_OBJECT_STORE, {
          keyPath: "localProjectId",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new ProjectStoreTransactionError(
          "Failed to open IndexedDB project store",
          request.error,
        ),
      );
    request.onblocked = () =>
      reject(
        new ProjectStoreTransactionError(
          "IndexedDB project store upgrade was blocked",
        ),
      );
  });
}

export async function openProjectStore(
  options: OpenProjectStoreOptions = {},
): Promise<ProjectStore> {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) {
    throw new ProjectStoreTransactionError("IndexedDB is not available");
  }
  const database = await openDatabase(
    factory,
    options.databaseName ?? PROJECT_STORE_DATABASE_NAME,
  );

  return {
    async get(localProjectId) {
      const transaction = database.transaction(PROJECTS_OBJECT_STORE, "readonly");
      const value = await requestResult(
        transaction.objectStore(PROJECTS_OBJECT_STORE).get(localProjectId),
      );
      await transactionDone(transaction);
      if (value === undefined) {
        throw new ProjectStoreNotFoundError(localProjectId);
      }
      return cloneRecord(assertValidRecord(value));
    },

    async list() {
      const transaction = database.transaction(PROJECTS_OBJECT_STORE, "readonly");
      const values = await requestResult(
        transaction.objectStore(PROJECTS_OBJECT_STORE).getAll(),
      );
      await transactionDone(transaction);
      return values
        .map(value => cloneRecord(assertValidRecord(value)))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async createOrReplace(record, expectedRevision) {
      const candidate = cloneRecord(assertValidRecord(record));
      const requiredRevision =
        expectedRevision === null ? 0 : expectedRevision + 1;
      if (candidate.revision !== requiredRevision) {
        throw new ProjectStoreInvalidRecordError(
          `Revision must be ${requiredRevision} for this write`,
        );
      }

      const transaction = database.transaction(
        PROJECTS_OBJECT_STORE,
        "readwrite",
      );
      const done = transactionDone(transaction);
      void done.catch(() => undefined);
      const objectStore = transaction.objectStore(PROJECTS_OBJECT_STORE);
      try {
        const current = (await requestResult(
          objectStore.get(candidate.localProjectId),
        )) as LocalProjectRecord | undefined;
        const actualRevision = current?.revision ?? null;
        if (actualRevision !== expectedRevision) {
          abortIfActive(transaction);
          await done.catch(() => undefined);
          throw new ProjectStoreRevisionConflictError(
            expectedRevision,
            actualRevision,
          );
        }
        objectStore.put(candidate);
        await done;
        return cloneRecord(candidate);
      } catch (error) {
        abortIfActive(transaction);
        await done.catch(() => undefined);
        throw mapWriteError(error);
      }
    },

    async delete(localProjectId) {
      const transaction = database.transaction(
        PROJECTS_OBJECT_STORE,
        "readwrite",
      );
      const done = transactionDone(transaction);
      void done.catch(() => undefined);
      const objectStore = transaction.objectStore(PROJECTS_OBJECT_STORE);
      try {
        const key = await requestResult(objectStore.getKey(localProjectId));
        if (key === undefined) {
          abortIfActive(transaction);
          await done.catch(() => undefined);
          throw new ProjectStoreNotFoundError(localProjectId);
        }
        objectStore.delete(localProjectId);
        await done;
      } catch (error) {
        abortIfActive(transaction);
        await done.catch(() => undefined);
        throw mapWriteError(error);
      }
    },

    close() {
      database.close();
    },
  };
}
