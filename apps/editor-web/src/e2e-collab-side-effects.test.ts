import {describe, expect, it, vi} from "vitest";
import {createCollabProvider} from "@blocksync/collab-webrtc";
import {createMemoryMesh} from "@blocksync/collab-webrtc";
import {sha256Hex} from "@blocksync/collaboration-domain";
import type {CostumeRef, ProjectDocument, ScratchTarget} from "@blocksync/project-schema";
import {
  createCollabSession,
  type CollabProviderConfig,
} from "./collab-session.js";
import {
  getE2eSideEffectCounters,
  recordE2eCollabOutbound,
  resetE2eSideEffectCounters,
} from "./e2e-side-effect-counters.js";

const STAGE_BYTES = new Uint8Array([1, 2, 3, 4]);

function costume(assetId: string): CostumeRef {
  return {
    kind: "costume",
    name: `${assetId}-c`,
    assetId,
    md5ext: `${assetId}.svg`,
    dataFormat: "svg",
    contentSha256: sha256Hex(STAGE_BYTES),
    rotationCenterX: 0,
    rotationCenterY: 0,
  };
}

function stage(): ScratchTarget {
  return {
    id: "stage",
    name: "Stage",
    isStage: true,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume("cccccccccccccccccccccccccccccccc")],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
  };
}

function project(): ProjectDocument {
  return {schemaVersion: 2, targets: [stage()], extensions: [], monitors: [], meta: {}};
}

function assetsFor(document: ProjectDocument): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const target of document.targets) {
    for (const c of target.costumes ?? []) {
      map.set(c.md5ext, STAGE_BYTES);
    }
  }
  return map;
}

describe("e2e collab outbound counter", () => {
  it("increments when a publishable session pushes local changes", async () => {
    resetE2eSideEffectCounters();
    const mesh = createMemoryMesh();
    const create = (config: CollabProviderConfig) =>
      createCollabProvider({
        doc: config.doc,
        secret: config.secret,
        transport: mesh.createTransport(),
        participantId: config.participantId,
        applyRemoteUpdate: config.applyRemoteUpdate,
        isLocalOrigin: config.isLocalOrigin,
      });
    const session = createCollabSession({
      roomId: "room-counter",
      secret: "room-counter-secret-room-counter-secret",
      participantId: "host",
      debounceMs: 0,
      createProvider: create,
      materializeLocal: () => {
        const document = project();
        return {document, assets: assetsFor(document)};
      },
      applyRemoteToLocal: async () => true,
      onLocalPush: recordE2eCollabOutbound,
    });
    expect(session.start({host: true}).ok).toBe(true);
    session.noteLocalChange({force: true});
    await session.flush();
    expect(getE2eSideEffectCounters().collabOutboundAttempts).toBeGreaterThan(0);
  });

  it("does not increment when noteLocalChange is suppressed before push", async () => {
    resetE2eSideEffectCounters();
    const onLocalPush = vi.fn();
    const mesh = createMemoryMesh();
    const create = (config: CollabProviderConfig) =>
      createCollabProvider({
        doc: config.doc,
        secret: config.secret,
        transport: mesh.createTransport(),
        participantId: config.participantId,
        applyRemoteUpdate: config.applyRemoteUpdate,
        isLocalOrigin: config.isLocalOrigin,
      });
    const session = createCollabSession({
      roomId: "room-suppressed",
      secret: "room-suppressed-secret-room-suppressed-secret",
      participantId: "host",
      debounceMs: 0,
      createProvider: create,
      materializeLocal: () => {
        const document = project();
        return {document, assets: assetsFor(document)};
      },
      applyRemoteToLocal: async () => true,
      onLocalPush,
    });
    expect(session.start({host: true}).ok).toBe(true);
    session.leave();
    session.noteLocalChange({force: true});
    await session.flush();
    expect(onLocalPush).not.toHaveBeenCalled();
  });
});
