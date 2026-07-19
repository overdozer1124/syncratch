import {describe, expect, it} from "vitest";
import * as Y from "yjs";
import {createCollabProvider} from "@blocksync/collab-webrtc";
import {createMemoryMesh} from "@blocksync/collab-webrtc";
import type {CostumeRef, ProjectDocument, ScratchTarget} from "@blocksync/project-schema";
import {
  createCollabSession,
  evaluateCollabReadiness,
  type CollabSession,
} from "./collab-session.js";

function costume(assetId: string): CostumeRef {
  return {
    kind: "costume",
    name: `${assetId}-c`,
    assetId,
    md5ext: `${assetId}.svg`,
    dataFormat: "svg",
    contentSha256: "b".repeat(64),
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

function sprite(id: string, name: string): ScratchTarget {
  const assetId = `${id}${"a".repeat(32 - id.length)}`;
  return {
    id,
    name,
    isStage: false,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume(assetId)],
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
    for (const c of target.costumes ?? []) map.set(c.md5ext, new Uint8Array([1, 2, 3, 4]));
  }
  return map;
}

/** A tiny mutable stand-in for the running VM + local project. */
function fakeVm(initial: ProjectDocument) {
  let document = structuredClone(initial);
  let assets = assetsFor(document);
  const appliedDocs: ProjectDocument[] = [];
  return {
    materializeLocal() {
      return {document: structuredClone(document), assets: new Map(assets)};
    },
    applyRemoteToLocal(doc: ProjectDocument, remoteAssets: Map<string, Uint8Array>) {
      document = structuredClone(doc);
      assets = new Map(remoteAssets);
      appliedDocs.push(structuredClone(doc));
    },
    editTargetName(id: string, name: string) {
      const target = document.targets.find((t) => t.id === id)!;
      target.name = name;
    },
    deleteTarget(id: string) {
      document.targets = document.targets.filter(target => target.id !== id);
    },
    current: () => document,
    lastApplied: () => appliedDocs[appliedDocs.length - 1],
  };
}

function sessionFactory(mesh: ReturnType<typeof createMemoryMesh>) {
  return (config: {
    doc: Y.Doc;
    secret: string;
    participantId: string;
    applyRemoteUpdate: (u: Uint8Array) => boolean;
    isLocalOrigin: (o: unknown) => boolean;
  }) =>
    createCollabProvider({
      doc: config.doc,
      secret: config.secret,
      transport: mesh.createTransport(),
      participantId: config.participantId,
      applyRemoteUpdate: config.applyRemoteUpdate,
      isLocalOrigin: config.isLocalOrigin,
    });
}

async function flush(...sessions: CollabSession[]): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.all(sessions.map((s) => s.flush()));
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("evaluateCollabReadiness", () => {
  it("requires Google, a linked Drive file, and configured signaling", () => {
    expect(evaluateCollabReadiness({googleConnected: false, driveFileId: "f", signalingUrl: "ws://x"}).ok).toBe(false);
    expect(evaluateCollabReadiness({googleConnected: true, driveFileId: undefined, signalingUrl: "ws://x"}).ok).toBe(false);
    expect(evaluateCollabReadiness({googleConnected: true, driveFileId: "f", signalingUrl: ""}).ok).toBe(false);
    expect(evaluateCollabReadiness({googleConnected: true, driveFileId: "f", signalingUrl: "ws://x"}).ok).toBe(true);
  });
});

describe("two-session convergence over WebRTC transport", () => {
  it("merges edits to different sprites and converges both local projects", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1"), sprite("s2", "S2")]);

    const vmA = fakeVm(source);
    const vmB = fakeVm(project([stage()]));
    const common = {roomId: "room-1", secret: "room-secret-room-secret-room-secret", debounceMs: 0};

    const a = createCollabSession({
      ...common,
      participantId: "peer-a",
      createProvider: create,
      materializeLocal: vmA.materializeLocal,
      applyRemoteToLocal: vmA.applyRemoteToLocal,
    });
    const b = createCollabSession({
      ...common,
      participantId: "peer-b",
      createProvider: create,
      materializeLocal: vmB.materializeLocal,
      applyRemoteToLocal: vmB.applyRemoteToLocal,
    });

    a.start({host: true});
    b.start({host: false});
    await flush(a, b);

    // B received the full project from A.
    expect(vmB.lastApplied()?.targets.map((t) => t.id).sort()).toEqual(["s1", "s2", "stage"]);

    // Concurrent edits to different sprites.
    vmA.editTargetName("s1", "EditedByA");
    a.noteLocalChange();
    vmB.editTargetName("s2", "EditedByB");
    b.noteLocalChange();
    await flush(a, b);

    const nameIn = (vm: ReturnType<typeof fakeVm>, id: string) =>
      vm.current().targets.find((t) => t.id === id)?.name;
    // Apply converged state back into each VM by forcing a final sync flush.
    await flush(a, b);
    expect(vmA.lastApplied()?.targets.find((t) => t.id === "s2")?.name).toBe("EditedByB");
    expect(vmB.lastApplied()?.targets.find((t) => t.id === "s1")?.name).toBe("EditedByA");
    expect(nameIn(vmA, "s1")).toBe("EditedByA");
  });

  it("does not overwrite a pending local edit when a remote edit arrives first", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1"), sprite("s2", "S2")]);
    const vmA = fakeVm(source);
    const vmB = fakeVm(source);
    const common = {
      roomId: "room-pending-local",
      secret: "pending-local-secret-pending-local-123",
    };
    const a = createCollabSession({
      ...common,
      debounceMs: 0,
      participantId: "peer-a",
      createProvider: create,
      materializeLocal: vmA.materializeLocal,
      applyRemoteToLocal: vmA.applyRemoteToLocal,
    });
    const b = createCollabSession({
      ...common,
      debounceMs: 100,
      participantId: "peer-b",
      createProvider: create,
      materializeLocal: vmB.materializeLocal,
      applyRemoteToLocal: vmB.applyRemoteToLocal,
    });

    a.start({host: true});
    b.start({host: false});
    await flush(a, b);

    vmB.editTargetName("s2", "PendingByB");
    b.noteLocalChange();
    vmA.editTargetName("s1", "FastByA");
    a.noteLocalChange();
    await new Promise(resolve => setTimeout(resolve, 20));
    await flush(a, b);
    await new Promise(resolve => setTimeout(resolve, 110));
    await flush(a, b);

    expect(vmA.current().targets.find(target => target.id === "s2")?.name)
      .toBe("PendingByB");
    expect(vmB.current().targets.find(target => target.id === "s1")?.name)
      .toBe("FastByA");
  });

  it("propagates a local target deletion to every peer", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1"), sprite("s2", "S2")]);
    const vmA = fakeVm(source);
    const vmB = fakeVm(source);
    const common = {
      roomId: "room-delete-target",
      secret: "delete-target-secret-delete-target-123",
      debounceMs: 0,
    };
    const a = createCollabSession({
      ...common,
      participantId: "peer-a",
      createProvider: create,
      materializeLocal: vmA.materializeLocal,
      applyRemoteToLocal: vmA.applyRemoteToLocal,
    });
    const b = createCollabSession({
      ...common,
      participantId: "peer-b",
      createProvider: create,
      materializeLocal: vmB.materializeLocal,
      applyRemoteToLocal: vmB.applyRemoteToLocal,
    });
    a.start({host: true});
    b.start({host: false});
    await flush(a, b);

    vmA.deleteTarget("s2");
    a.noteLocalChange();
    await flush(a, b);

    expect(vmA.current().targets.some(target => target.id === "s2")).toBe(false);
    expect(vmB.current().targets.some(target => target.id === "s2")).toBe(false);
  });
});

describe("deterministic leadership and leader-only Drive writes", () => {
  it("elects a single leader, shares its epoch, and gates Drive writes", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    const common = {roomId: "room-2", secret: "secret-secret-secret-secret-secret-1", debounceMs: 0};

    const a = createCollabSession({...common, participantId: "peer-a", createProvider: create, materializeLocal: fakeVm(source).materializeLocal, applyRemoteToLocal: () => {}});
    const b = createCollabSession({...common, participantId: "peer-b", createProvider: create, materializeLocal: fakeVm(project([stage()])).materializeLocal, applyRemoteToLocal: () => {}});

    a.start({host: true});
    b.start({host: false});
    await flush(a, b);

    // Deterministic: "peer-a" < "peer-b" is leader on both.
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
    expect(a.leadershipEpoch()).toBe(b.leadershipEpoch());
    expect(a.leadershipEpoch()).not.toBe("0");
    expect(a.canPersistToDrive().ok).toBe(true);
    expect(b.canPersistToDrive().ok).toBe(false);
  });

  it("re-elects deterministically with a new epoch when the leader leaves", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const common = {roomId: "room-3", secret: "another-secret-another-secret-abc12", debounceMs: 0};
    const a = createCollabSession({...common, participantId: "peer-a", createProvider: create, materializeLocal: fakeVm(project([stage()])).materializeLocal, applyRemoteToLocal: () => {}});
    const b = createCollabSession({...common, participantId: "peer-b", createProvider: create, materializeLocal: fakeVm(project([stage()])).materializeLocal, applyRemoteToLocal: () => {}});

    a.start({host: true});
    b.start({host: false});
    await flush(a, b);
    const epochBefore = b.leadershipEpoch();

    a.leave();
    await flush(b);
    expect(b.isLeader()).toBe(true);
    expect(b.leadershipEpoch()).not.toBe(epochBefore);
    expect(b.canPersistToDrive().ok).toBe(true);
  });

  it("blocks Drive writes while transport is disconnected", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const session = createCollabSession({
      roomId: "room-disconnected",
      secret: "disconnected-secret-disconnected-123",
      debounceMs: 0,
      participantId: "peer-a",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
    });

    session.start({host: true});
    await flush(session);
    session.provider.disconnect();

    expect(session.canPersistToDrive()).toEqual({
      ok: false,
      reason: "Collaboration is disconnected; Drive saving is paused",
    });
  });

  it("re-observes Drive before a newly elected leader may write", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    let releaseObservation!: () => void;
    const observation = new Promise<void>(resolve => {
      releaseObservation = resolve;
    });
    const common = {
      roomId: "room-handoff",
      secret: "handoff-secret-handoff-secret-12345",
      debounceMs: 0,
    };
    const a = createCollabSession({
      ...common,
      participantId: "peer-a",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    const b = createCollabSession({
      ...common,
      participantId: "peer-b",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
      reobserveDriveBeforeLeadership: () => observation,
    });

    a.start({host: true});
    b.start({host: false});
    await flush(a, b);
    a.leave();
    await flush(b);

    expect(b.isLeader()).toBe(true);
    expect(b.canPersistToDrive()).toEqual({
      ok: false,
      reason: "Drive metadata is being re-observed after leader handoff",
    });

    releaseObservation();
    await observation;
    await flush(b);
    expect(b.canPersistToDrive().ok).toBe(true);
  });
});

describe("conflict handling stops automatic Drive saves", () => {
  it("refuses further Drive writes after a reported conflict without losing local data", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const vm = fakeVm(project([stage(), sprite("s1", "S1")]));
    const session = createCollabSession({
      roomId: "room-4",
      secret: "conflict-secret-conflict-secret-9999",
      debounceMs: 0,
      participantId: "peer-a",
      createProvider: create,
      materializeLocal: vm.materializeLocal,
      applyRemoteToLocal: vm.applyRemoteToLocal,
    });
    session.start({host: true});
    await flush(session);
    expect(session.canPersistToDrive().ok).toBe(true);

    session.reportDriveConflict();
    expect(session.canPersistToDrive().ok).toBe(false);
    expect(session.getState().conflict).toBe(true);
    // Local project remains intact.
    expect(vm.current().targets.some((t) => t.id === "s1")).toBe(true);
  });
});
