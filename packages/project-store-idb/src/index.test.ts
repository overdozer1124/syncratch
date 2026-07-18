import {afterEach, describe, expect, it} from "vitest";
import "fake-indexeddb/auto";
import {emptyProject} from "@blocksync/project-schema";
import {
  LOCAL_PROJECT_FORMAT,
  type LocalProjectRecord,
} from "@blocksync/project-local-core";
import {
  openProjectStore,
  PROJECT_STORE_DATABASE_VERSION,
  PROJECTS_OBJECT_STORE,
  ProjectStoreInvalidRecordError,
  ProjectStoreNotFoundError,
  ProjectStoreQuotaError,
  ProjectStoreRevisionConflictError,
  ProjectStoreTransactionError,
  UPDATED_AT_INDEX,
} from "./index.js";

const databases = new Set<string>();

function record(
  localProjectId = "project-1",
  revision = 0,
): LocalProjectRecord {
  return {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId,
    title: "Local project",
    revision,
    updatedAt: "2026-07-19T00:00:00.000Z",
    document: emptyProject(),
    assets: [{
      md5ext: "asset.svg",
      bytes: new Uint8Array([1, 2, 255]),
    }],
    saveState: "clean",
  };
}

function databaseName(label: string): string {
  const name = `blocksync-test-${label}-${crypto.randomUUID()}`;
  databases.add(name);
  return name;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  await Promise.all([...databases].map(deleteDatabase));
  databases.clear();
});

describe("IndexedDB project store", () => {
  it("creates the projects store and updatedAt index in database version 1", async () => {
    const name = databaseName("version-one");
    const store = await openProjectStore({databaseName: name});
    store.close();

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(PROJECTS_OBJECT_STORE, "readonly");
    expect(PROJECT_STORE_DATABASE_VERSION).toBe(1);
    expect(database.version).toBe(1);
    expect(
      transaction.objectStore(PROJECTS_OBJECT_STORE).indexNames.contains(
        UPDATED_AT_INDEX,
      ),
    ).toBe(true);
    database.close();
  });

  it("creates, reads, and lists structured-cloned records", async () => {
    const store = await openProjectStore({databaseName: databaseName("crud")});
    const source = record();

    const created = await store.createOrReplace(source, null);
    source.title = "mutated source";
    source.assets[0]!.bytes[0] = 99;
    created.title = "mutated result";

    const loaded = await store.get("project-1");
    expect(loaded.title).toBe("Local project");
    expect([...loaded.assets[0]!.bytes]).toEqual([1, 2, 255]);
    expect(loaded.assets[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect(await store.list()).toEqual([loaded]);
    store.close();
  });

  it("atomically replaces at the expected revision", async () => {
    const store = await openProjectStore({databaseName: databaseName("cas")});
    await store.createOrReplace(record("project-1", 0), null);

    const replacement = record("project-1", 1);
    replacement.title = "Revision one";
    const saved = await store.createOrReplace(replacement, 0);

    expect(saved.revision).toBe(1);
    expect((await store.get("project-1")).title).toBe("Revision one");
    store.close();
  });

  it("rejects stale CAS without overwriting the newer record", async () => {
    const store = await openProjectStore({databaseName: databaseName("stale")});
    await store.createOrReplace(record("project-1", 0), null);
    await store.createOrReplace(record("project-1", 1), 0);

    const stale = record("project-1", 1);
    stale.title = "stale overwrite";
    await expect(store.createOrReplace(stale, 0)).rejects.toBeInstanceOf(
      ProjectStoreRevisionConflictError,
    );
    expect((await store.get("project-1")).title).toBe("Local project");
    store.close();
  });

  it("restores records after closing and reopening the database", async () => {
    const name = databaseName("reload");
    const first = await openProjectStore({databaseName: name});
    await first.createOrReplace(record(), null);
    first.close();

    const reopened = await openProjectStore({databaseName: name});
    expect(await reopened.get("project-1")).toMatchObject({
      localProjectId: "project-1",
      revision: 0,
    });
    reopened.close();
  });

  it("returns null when no latest project exists", async () => {
    const store = await openProjectStore({databaseName: databaseName("latest-empty")});

    expect(await store.getLatest()).toBeNull();
    store.close();
  });

  it("returns only the project with the newest updatedAt", async () => {
    const store = await openProjectStore({databaseName: databaseName("latest")});
    const older = record("older");
    older.updatedAt = "2026-07-18T00:00:00.000Z";
    older.assets = [{md5ext: "large.bin", bytes: new Uint8Array(1_000_000)}];
    const newer = record("newer");
    newer.updatedAt = "2026-07-19T00:00:00.000Z";
    await store.createOrReplace(older, null);
    await store.createOrReplace(newer, null);

    expect(await store.getLatest()).toMatchObject({
      localProjectId: "newer",
      updatedAt: newer.updatedAt,
    });
    store.close();
  });

  it("uses one reverse index cursor without getAll or scanning older assets", async () => {
    const store = await openProjectStore({databaseName: databaseName("latest-cursor")});
    const older = record("older");
    older.updatedAt = "2026-07-18T00:00:00.000Z";
    const newer = record("newer");
    newer.updatedAt = "2026-07-19T00:00:00.000Z";
    await store.createOrReplace(older, null);
    await store.createOrReplace(newer, null);
    const originalGetAll = IDBObjectStore.prototype.getAll;
    const originalContinue = IDBCursor.prototype.continue;
    let continueCalls = 0;
    IDBObjectStore.prototype.getAll = function forbiddenGetAll() {
      throw new Error("getAll must not be used by getLatest");
    };
    IDBCursor.prototype.continue = function trackedContinue(key?: IDBValidKey) {
      continueCalls += 1;
      return originalContinue.call(this, key);
    };

    try {
      expect((await store.getLatest())?.localProjectId).toBe("newer");
      expect(continueCalls).toBe(0);
    } finally {
      IDBObjectStore.prototype.getAll = originalGetAll;
      IDBCursor.prototype.continue = originalContinue;
      store.close();
    }
  });

  it("deletes projects and reports typed not-found errors", async () => {
    const store = await openProjectStore({databaseName: databaseName("delete")});
    await store.createOrReplace(record(), null);

    await store.delete("project-1");

    await expect(store.get("project-1")).rejects.toBeInstanceOf(
      ProjectStoreNotFoundError,
    );
    await expect(store.delete("project-1")).rejects.toBeInstanceOf(
      ProjectStoreNotFoundError,
    );
    store.close();
  });

  it("rejects malformed records before writing", async () => {
    const store = await openProjectStore({databaseName: databaseName("invalid")});
    const malformed = {...record(), revision: -1} as LocalProjectRecord;

    await expect(store.createOrReplace(malformed, null)).rejects.toBeInstanceOf(
      ProjectStoreInvalidRecordError,
    );
    expect(await store.list()).toEqual([]);
    store.close();
  });

  it("aborts a failed transaction without leaving a partial record", async () => {
    const name = databaseName("abort");
    const store = await openProjectStore({databaseName: name});
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function failingPut() {
      this.transaction.abort();
      return originalPut.apply(this, arguments as unknown as [unknown]);
    };

    try {
      await expect(store.createOrReplace(record(), null)).rejects.toBeInstanceOf(
        ProjectStoreTransactionError,
      );
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    expect(await store.list()).toEqual([]);
    store.close();
  });

  it("maps quota failures to a typed quota error", async () => {
    const store = await openProjectStore({databaseName: databaseName("quota")});
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function quotaPut(): IDBRequest<IDBValidKey> {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };

    try {
      await expect(store.createOrReplace(record(), null)).rejects.toBeInstanceOf(
        ProjectStoreQuotaError,
      );
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    expect(await store.list()).toEqual([]);
    store.close();
  });
});
