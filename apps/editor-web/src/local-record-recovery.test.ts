import {describe, expect, it, vi} from "vitest";
import {emptyProject, type CostumeRef, type ProjectDocument} from "@blocksync/project-schema";
import {LOCAL_PROJECT_FORMAT, type LocalProjectRecord} from "@blocksync/project-local-core";
import {createSaveCoordinator} from "./save-coordinator.js";
import {
  assetRecordsFromMap,
  createCorruptRecordRecovery,
  createRecoveryCopy,
  findMissingAssets,
  isMissingAssetError,
  MissingAssetError,
  recoverLoadedRecord,
} from "./local-record-recovery.js";

const STAGE_COSTUME: CostumeRef = {
  kind: "costume",
  name: "backdrop",
  assetId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  md5ext: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
  dataFormat: "svg",
  contentSha256: "abc",
  rotationCenterX: 0,
  rotationCenterY: 0,
};

function documentWithStage(): ProjectDocument {
  return {
    ...emptyProject(),
    targets: [{
      id: "stage",
      name: "Stage",
      isStage: true,
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [STAGE_COSTUME],
      sounds: [],
      volume: 100,
      layerOrder: 0,
      tempo: 60,
      videoTransparency: 50,
      videoState: "on",
      textToSpeechLanguage: null,
    }],
  };
}

function baseRecord(): LocalProjectRecord {
  const document = documentWithStage();
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId: "local-corrupt",
    title: "Broken project",
    revision: 3,
    updatedAt: "2026-07-20T00:00:00.000Z",
    document,
    assets: [{md5ext: STAGE_COSTUME.md5ext, bytes}],
    saveState: "error",
    driveFileId: "drive-1",
  };
}

describe("findMissingAssets", () => {
  it("reports md5ext values referenced by the document but absent from the asset map", () => {
    const document = documentWithStage();
    const assets = new Map<string, Uint8Array>();

    expect(findMissingAssets(document, assets)).toEqual([
      STAGE_COSTUME.md5ext,
    ]);
  });

  it("returns an empty list when every referenced asset is present", () => {
    const document = documentWithStage();
    const assets = new Map([
      [STAGE_COSTUME.md5ext, new Uint8Array([1, 2, 3])],
    ]);

    expect(findMissingAssets(document, assets)).toEqual([]);
  });
});

describe("assetRecordsFromMap", () => {
  it("throws MissingAssetError when required assets are absent", () => {
    expect(() =>
      assetRecordsFromMap(documentWithStage(), new Map()),
    ).toThrow(MissingAssetError);
  });
});

describe("createRecoveryCopy", () => {
  it("creates a new local project record from runtime state", () => {
    const current = baseRecord();
    const runtimeAssets = new Map([
      [STAGE_COSTUME.md5ext, new Uint8Array([9, 9, 9])],
    ]);
    const document = documentWithStage();

    const recovery = createRecoveryCopy({
      current,
      title: "Recovered title",
      document,
      assets: runtimeAssets,
      localProjectId: "local-recovered",
      now: () => "2026-07-20T12:00:00.000Z",
    });

    expect(recovery.localProjectId).toBe("local-recovered");
    expect(recovery.revision).toBe(0);
    expect(recovery.title).toBe("Recovered title");
    expect(recovery.saveState).toBe("clean");
    expect(recovery.driveFileId).toBe("drive-1");
    expect(recovery.updatedAt).toBe("2026-07-20T12:00:00.000Z");
    expect(recovery.assets).toEqual([
      {md5ext: STAGE_COSTUME.md5ext, bytes: new Uint8Array([9, 9, 9])},
    ]);
    expect(recovery.localProjectId).not.toBe(current.localProjectId);
  });

  it("omits an empty Drive file id from the recovery copy", () => {
    const recovery = createRecoveryCopy({
      current: {...baseRecord(), driveFileId: ""},
      title: "Recovered title",
      document: documentWithStage(),
      assets: new Map([[STAGE_COSTUME.md5ext, new Uint8Array([9, 9, 9])]]),
      localProjectId: "local-recovered",
    });

    expect(recovery.driveFileId).toBeUndefined();
  });
});

describe("isMissingAssetError", () => {
  it("recognizes MissingAssetError instances", () => {
    expect(isMissingAssetError(new MissingAssetError(["a.svg"]))).toBe(true);
    expect(isMissingAssetError(new Error("Missing asset a.svg"))).toBe(true);
    expect(isMissingAssetError(new Error("IndexedDB failed"))).toBe(false);
  });
});

describe("recoverCorruptRecord coordination", () => {
  it("does not leave a recovery copy when its project session becomes stale", async () => {
    const source: LocalProjectRecord = {...baseRecord(), assets: []};
    const runtimeAssets = new Map([
      [STAGE_COSTUME.md5ext, new Uint8Array([9, 9, 9])],
    ]);
    let active = true;
    let finishPersist!: () => void;
    const persistGate = new Promise<void>(resolve => {
      finishPersist = resolve;
    });
    const persisted = new Map<string, LocalProjectRecord>();
    let current = source;
    const coordinator = createCorruptRecordRecovery();

    const recovery = coordinator.recover({
      current: source,
      title: source.title,
      document: source.document,
      assets: runtimeAssets,
      localProjectId: "stale-recovery",
      isActive: () => active,
      async persist(record) {
        persisted.set(record.localProjectId, record);
        await persistGate;
        return record;
      },
      async remove(record) {
        persisted.delete(record.localProjectId);
      },
      commit(record) {
        if (active) current = record;
      },
    });
    await vi.waitFor(() => expect(persisted.size).toBe(1));
    active = false;
    finishPersist();
    await recovery;

    expect(current.localProjectId).toBe(source.localProjectId);
    expect([...persisted]).toEqual([]);
  });

  it("uses one recovery write for concurrent callers", async () => {
    const source: LocalProjectRecord = {...baseRecord(), assets: []};
    const runtimeAssets = new Map([
      [STAGE_COSTUME.md5ext, new Uint8Array([9, 9, 9])],
    ]);
    let finishPersist!: () => void;
    const persistGate = new Promise<void>(resolve => {
      finishPersist = resolve;
    });
    const persist = vi.fn(async (record: LocalProjectRecord) => {
      await persistGate;
      return record;
    });
    const commit = vi.fn();
    const coordinator = createCorruptRecordRecovery();

    const first = coordinator.recover({
      current: source,
      title: source.title,
      document: source.document,
      assets: runtimeAssets,
      localProjectId: "recovery-1",
      isActive: () => true,
      persist,
      remove: async () => undefined,
      commit,
    });
    const second = coordinator.recover({
      current: source,
      title: source.title,
      document: source.document,
      assets: runtimeAssets,
      localProjectId: "recovery-2",
      isActive: () => true,
      persist,
      remove: async () => undefined,
      commit,
    });
    await vi.waitFor(() => expect(persist).toHaveBeenCalled());

    expect(persist).toHaveBeenCalledTimes(1);
    finishPersist();
    await Promise.all([first, second]);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe("recoverLoadedRecord", () => {
  it("handles automatic recovery failure through the save coordinator", async () => {
    const coordinator = createSaveCoordinator({
      debounceMs: 10,
      save: async () => {
        throw new Error("IndexedDB recovery failed");
      },
    });

    const outcome = await recoverLoadedRecord({
      coordinator,
    }).then(
      () => "resolved",
      () => "rejected",
    );

    expect(outcome).toBe("resolved");
    expect(coordinator.getState()).toBe("error");
  });
});
