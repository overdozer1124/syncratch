import {describe, expect, it} from "vitest";
import * as Y from "yjs";
import {contentHash} from "@blocksync/project-envelope";
import type {CostumeRef, ProjectDocument, ScratchTarget} from "@blocksync/project-schema";
import {
  LOCAL_ORIGIN,
  ProjectCollaborationDocument,
} from "./project-collab.js";
import {
  buildAssetManifest,
  bytesFromBase64Url,
  encodeStateVectorBase64,
  newBootstrapId,
  runHostPreflight,
  sha256Hex,
  stateVectorContains,
  validateSealedCheckpoint,
  writeBootstrapSealed,
  writeBootstrapSeeding,
} from "./bootstrap.js";

function costume(assetId: string, bytes: Uint8Array): CostumeRef {
  return {
    kind: "costume",
    name: `${assetId}-c`,
    assetId,
    md5ext: `${assetId}.svg`,
    dataFormat: "svg",
    contentSha256: sha256Hex(bytes),
    rotationCenterX: 0,
    rotationCenterY: 0,
  };
}

const stageBytes = new Uint8Array([1, 2, 3, 4]);
const spriteBytes = new Uint8Array([5, 6, 7, 8]);

function stage(): ScratchTarget {
  return {
    id: "stage",
    name: "Stage",
    isStage: true,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume("cccccccccccccccccccccccccccccccc", stageBytes)],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
  };
}

function sprite(id: string): ScratchTarget {
  const assetId = `${id}${"a".repeat(32 - id.length)}`;
  return {
    id,
    name: `Sprite-${id}`,
    isStage: false,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume(assetId, spriteBytes)],
    sounds: [],
    volume: 100,
    layerOrder: 1,
    visible: true,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: "all around",
  };
}

function project(targets: ScratchTarget[]): ProjectDocument {
  return {schemaVersion: 2, targets, extensions: [], monitors: [], meta: {}};
}

function assetsFor(document: ProjectDocument): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const target of document.targets) {
    for (const c of target.costumes ?? []) {
      map.set(c.md5ext, target.isStage ? stageBytes : spriteBytes);
    }
  }
  return map;
}

describe("host preflight", () => {
  it("accepts a complete hashed project", () => {
    const source = project([stage(), sprite("s1")]);
    const result = runHostPreflight(source, assetsFor(source), {projectTitle: "Demo"});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documentHash).toBe(contentHash(source));
    expect(result.assetManifest).toEqual(buildAssetManifest(source, assetsFor(source)));
  });

  it("rejects missing and hash-mismatched assets", () => {
    const source = project([stage(), sprite("s1")]);
    const assets = assetsFor(source);
    assets.delete(stage().costumes![0]!.md5ext);
    expect(runHostPreflight(source, assets).ok).toBe(false);

    const mismatched = project([stage()]);
    mismatched.targets[0]!.costumes![0]!.contentSha256 = "0".repeat(64);
    expect(runHostPreflight(mismatched, assetsFor(mismatched)).ok).toBe(false);
  });
});

describe("state vector containment and sealed validation", () => {
  it("detects when the staging vector does not yet contain the seal", () => {
    const host = new ProjectCollaborationDocument();
    const source = project([stage(), sprite("s1")]);
    const assets = assetsFor(source);
    host.loadLocalProject(source, assets);
    const bootstrapId = newBootstrapId(() => new Uint8Array(16).fill(7));
    writeBootstrapSeeding(host.ydoc, bootstrapId, LOCAL_ORIGIN);
    const sv = encodeStateVectorBase64(host.ydoc);
    const preflight = runHostPreflight(source, assets);
    if (!preflight.ok) throw new Error("preflight");
    writeBootstrapSealed(host.ydoc, {
      bootstrapId,
      projectTitle: "T",
      contentStateVector: sv,
      documentHash: preflight.documentHash,
      assetManifest: preflight.assetManifest,
    }, LOCAL_ORIGIN);

    const guest = new ProjectCollaborationDocument();
    const expectedBytes = bytesFromBase64Url(sv);
    expect(expectedBytes).not.toBeNull();
    expect(Y.decodeStateVector(expectedBytes!).size).toBeGreaterThan(0);
    expect(
      stateVectorContains(Y.encodeStateVector(guest.ydoc), expectedBytes!),
    ).toBe(false);

    guest.applyRemoteUpdate(host.encodeState());
    const result = validateSealedCheckpoint(guest.ydoc, () => guest.materialize());
    expect(result.status).toBe("ready");
  });

  it("waits for a newer seal when content races an older seal", () => {
    const host = new ProjectCollaborationDocument();
    const source = project([stage(), sprite("s1")]);
    const assets = assetsFor(source);
    host.loadLocalProject(source, assets);
    const bootstrapId = "seal-1";
    writeBootstrapSeeding(host.ydoc, bootstrapId, LOCAL_ORIGIN);
    const sv = encodeStateVectorBase64(host.ydoc);
    const preflight = runHostPreflight(source, assets);
    if (!preflight.ok) throw new Error("preflight");
    writeBootstrapSealed(host.ydoc, {
      bootstrapId,
      contentStateVector: sv,
      documentHash: preflight.documentHash,
      assetManifest: preflight.assetManifest,
      projectTitle: "T",
    }, LOCAL_ORIGIN);

    // Newer content after seal.
    const edited = structuredClone(source);
    edited.targets[1]!.name = "Edited";
    host.setTarget(edited.targets[1]!);

    const guest = new ProjectCollaborationDocument();
    guest.applyRemoteUpdate(host.encodeState());
    const result = validateSealedCheckpoint(guest.ydoc, () => guest.materialize());
    expect(result.status).toBe("awaiting-newer-seal");
  });

  it("rejects a present asset with the wrong digest as invalid", () => {
    const host = new ProjectCollaborationDocument();
    const source = project([stage()]);
    const assets = assetsFor(source);
    host.loadLocalProject(source, assets);
    const bootstrapId = "seal-bad";
    writeBootstrapSeeding(host.ydoc, bootstrapId, LOCAL_ORIGIN);
    const sv = encodeStateVectorBase64(host.ydoc);
    const preflight = runHostPreflight(source, assets);
    if (!preflight.ok) throw new Error("preflight");
    const badManifest = preflight.assetManifest.map(entry => ({
      ...entry,
      contentSha256: "f".repeat(64),
    }));
    writeBootstrapSealed(host.ydoc, {
      bootstrapId,
      contentStateVector: sv,
      documentHash: preflight.documentHash,
      assetManifest: badManifest,
      projectTitle: "T",
    }, LOCAL_ORIGIN);

    const guest = new ProjectCollaborationDocument();
    guest.applyRemoteUpdate(host.encodeState());
    const result = validateSealedCheckpoint(guest.ydoc, () => guest.materialize());
    expect(result.status).toBe("invalid");
  });
});
