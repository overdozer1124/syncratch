import {describe, expect, it} from "vitest";
import {emptyProject, type CostumeRef, type ProjectDocument} from "@blocksync/project-schema";
import {LOCAL_PROJECT_FORMAT, type LocalProjectRecord} from "@blocksync/project-local-core";
import {
  assetRecordsFromMap,
  createRecoveryCopy,
  findMissingAssets,
  isMissingAssetError,
  MissingAssetError,
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
