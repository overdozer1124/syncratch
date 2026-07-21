import {describe, expect, it, vi} from "vitest";
import * as Y from "yjs";
import {sha256Hex} from "@blocksync/collaboration-domain";
import {createCollabProvider} from "@blocksync/collab-webrtc";
import {createMemoryMesh} from "@blocksync/collab-webrtc";
import type {CostumeRef, ProjectDocument, ScratchTarget} from "@blocksync/project-schema";
import {
  createCollabSession,
  evaluateCollabReadiness,
  type ApplyRemoteContext,
  type CollabProviderConfig,
  type CollabSession,
} from "./collab-session.js";

const STAGE_BYTES = new Uint8Array([1, 2, 3, 4]);
const SPRITE_BYTES = new Uint8Array([1, 2, 3, 4]);

function costume(assetId: string, bytes: Uint8Array = SPRITE_BYTES): CostumeRef {
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

function stage(): ScratchTarget {
  return {
    id: "stage",
    name: "Stage",
    isStage: true,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume("cccccccccccccccccccccccccccccccc", STAGE_BYTES)],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
  };
}

function sprite(id: string, name: string, blocks?: ScratchTarget["blocks"]): ScratchTarget {
  const assetId = `${id}${"a".repeat(32 - id.length)}`;
  return {
    id,
    name,
    isStage: false,
    blocks: blocks ?? {},
    comments: {},
    currentCostume: 0,
    costumes: [costume(assetId, SPRITE_BYTES)],
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
      map.set(c.md5ext, target.isStage ? STAGE_BYTES : SPRITE_BYTES);
    }
  }
  return map;
}

/** A tiny mutable stand-in for the running VM + local project. */
function fakeVm(initial: ProjectDocument) {
  let document = structuredClone(initial);
  let assets = assetsFor(document);
  const appliedDocs: ProjectDocument[] = [];
  let previousBeforeGuestInitial: {
    document: ProjectDocument;
    assets: Map<string, Uint8Array>;
  } | null = null;
  let rollbackCount = 0;
  return {
    materializeLocal() {
      return {document: structuredClone(document), assets: new Map(assets)};
    },
    applyRemoteToLocal(
      doc: ProjectDocument,
      remoteAssets: Map<string, Uint8Array>,
      context: ApplyRemoteContext,
    ) {
      if (context.mode === "guest-initial") {
        previousBeforeGuestInitial = {
          document: structuredClone(document),
          assets: new Map(assets),
        };
      }
      document = structuredClone(doc);
      assets = new Map(remoteAssets);
      appliedDocs.push(structuredClone(doc));
    },
    rollbackGuestInitialLocal() {
      if (!previousBeforeGuestInitial) return;
      document = previousBeforeGuestInitial.document;
      assets = previousBeforeGuestInitial.assets;
      previousBeforeGuestInitial = null;
      rollbackCount += 1;
    },
    editTargetName(id: string, name: string) {
      const target = document.targets.find((t) => t.id === id)!;
      target.name = name;
    },
    replaceTarget(target: ScratchTarget) {
      const index = document.targets.findIndex((t) => t.id === target.id);
      if (index < 0) {
        document.targets.push(structuredClone(target));
        return;
      }
      document.targets[index] = structuredClone(target);
    },
    deleteTarget(id: string) {
      document.targets = document.targets.filter(target => target.id !== id);
    },
    addTarget(target: ScratchTarget, withAssets = true) {
      document.targets.push(structuredClone(target));
      if (withAssets) {
        for (const c of target.costumes ?? []) {
          assets.set(c.md5ext, SPRITE_BYTES);
        }
      }
    },
    putAsset(md5ext: string, bytes: Uint8Array) {
      assets.set(md5ext, bytes);
    },
    current: () => document,
    lastApplied: () => appliedDocs[appliedDocs.length - 1],
    rollbackCount: () => rollbackCount,
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
  for (let i = 0; i < 8; i += 1) {
    await Promise.all(sessions.map((s) => s.flush()));
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("evaluateCollabReadiness", () => {
  it("requires only configured signaling", () => {
    expect(evaluateCollabReadiness({signalingUrl: ""}).ok).toBe(false);
    expect(evaluateCollabReadiness({signalingUrl: "ws://x"}).ok).toBe(true);
  });
});

describe("guest bootstrap terminal-state guards", () => {
  it("ignores every update after invalid-project without changing state, counters, or staging", async () => {
    const mesh = createMemoryMesh();
    let deliverRemoteUpdate!: (update: Uint8Array) => boolean;
    const create = (config: CollabProviderConfig) => {
      deliverRemoteUpdate = config.applyRemoteUpdate;
      return createCollabProvider({
        doc: config.doc,
        secret: config.secret,
        transport: mesh.createTransport(),
        participantId: config.participantId,
        applyRemoteUpdate: config.applyRemoteUpdate,
        isLocalOrigin: config.isLocalOrigin,
      });
    };
    const stateEvents: string[] = [];
    const vm = fakeVm(project([stage()]));
    const guest = createCollabSession({
      roomId: "room-invalid-terminal",
      secret: "invalid-terminal-secret-invalid-terminal",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: vm.materializeLocal,
      applyRemoteToLocal: vm.applyRemoteToLocal,
      onState: state => stateEvents.push(state.bootstrapPhase),
    });
    guest.start({host: false});

    expect(deliverRemoteUpdate(new Uint8Array(16 * 1024 * 1024 + 1))).toBe(false);
    expect(guest.getBootstrapPhase()).toBe("invalid-project");
    expect(guest.domain.tryApplyStagingUpdate(new Uint8Array([0, 0])).accepted)
      .toBe(false);
    const frozenDiagnostics = guest.getDiagnostics();
    const frozenState = guest.domain.encodeState();
    const frozenEventCount = stateEvents.length;

    const laterRemote = new Y.Doc();
    laterRemote.getMap("probe").set("post-invalid", "must-not-apply");
    const laterUpdate = Y.encodeStateAsUpdate(laterRemote);
    expect(deliverRemoteUpdate(laterUpdate)).toBe(false);
    await guest.flush();

    expect(guest.getDiagnostics()).toEqual(frozenDiagnostics);
    expect(guest.domain.encodeState()).toEqual(frozenState);
    expect(guest.domain.ydoc.getMap("probe").has("post-invalid")).toBe(false);
    expect(stateEvents).toHaveLength(frozenEventCount);
  });

  it("keeps invalid-project terminal when an earlier local save finishes", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    const previousGuestProject = project([stage(), sprite("local", "KeepMe")]);
    const guestVm = fakeVm(previousGuestProject);
    let deliverGuestUpdate!: (update: Uint8Array) => boolean;
    let markSaveStarted!: () => void;
    let releaseSave!: () => void;
    const saveStarted = new Promise<void>(resolve => {
      markSaveStarted = resolve;
    });
    const saveGate = new Promise<void>(resolve => {
      releaseSave = resolve;
    });
    const stateEvents: string[] = [];
    const host = createCollabSession({
      roomId: "room-invalid-in-flight",
      secret: "invalid-in-flight-secret-invalid-in-flight",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: fakeVm(source).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    const guest = createCollabSession({
      roomId: "room-invalid-in-flight",
      secret: "invalid-in-flight-secret-invalid-in-flight",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: (config: CollabProviderConfig) => {
        deliverGuestUpdate = config.applyRemoteUpdate;
        return create(config);
      },
      materializeLocal: guestVm.materializeLocal,
      applyRemoteToLocal: async (document, assets, context) => {
        markSaveStarted();
        await saveGate;
        guestVm.applyRemoteToLocal(document, assets, context);
        return true;
      },
      rollbackGuestInitialLocal: () => guestVm.rollbackGuestInitialLocal(),
      onState: state => stateEvents.push(state.bootstrapPhase),
    });

    expect(host.start({host: true}).ok).toBe(true);
    guest.start({host: false});
    await host.provider.flush();
    await guest.provider.flush();
    const pendingGuestFlush = guest.flush();
    await saveStarted;

    expect(deliverGuestUpdate(new Uint8Array(16 * 1024 * 1024 + 1))).toBe(false);
    expect(guest.getBootstrapPhase()).toBe("invalid-project");
    const frozenDiagnostics = guest.getDiagnostics();
    const frozenState = guest.getState();
    const frozenEncodedState = guest.domain.encodeState();
    const frozenEventCount = stateEvents.length;

    releaseSave();
    await pendingGuestFlush;

    expect(guest.getBootstrapPhase()).toBe("invalid-project");
    expect(guest.getDiagnostics()).toEqual(frozenDiagnostics);
    expect(guest.getState()).toEqual(frozenState);
    expect(guest.domain.encodeState()).toEqual(frozenEncodedState);
    expect(stateEvents).toHaveLength(frozenEventCount);
    expect(guestVm.current().targets.find(target => target.id === "local")?.name)
      .toBe("KeepMe");
    expect(guestVm.rollbackCount()).toBe(1);
  });

  it("keeps invalid-project terminal when a retry save finishes", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    let deliverGuestUpdate!: (update: Uint8Array) => boolean;
    let markRetryStarted!: () => void;
    let releaseRetry!: () => void;
    const retryStarted = new Promise<void>(resolve => {
      markRetryStarted = resolve;
    });
    const retryGate = new Promise<void>(resolve => {
      releaseRetry = resolve;
    });
    let saveAttempt = 0;
    const stateEvents: string[] = [];
    const host = createCollabSession({
      roomId: "room-invalid-retry",
      secret: "invalid-retry-secret-invalid-retry",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: fakeVm(source).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    const guest = createCollabSession({
      roomId: "room-invalid-retry",
      secret: "invalid-retry-secret-invalid-retry",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: (config: CollabProviderConfig) => {
        deliverGuestUpdate = config.applyRemoteUpdate;
        return create(config);
      },
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: async () => {
        saveAttempt += 1;
        if (saveAttempt === 1) throw new Error("initial save failed");
        markRetryStarted();
        await retryGate;
        return true;
      },
      onState: state => stateEvents.push(state.bootstrapPhase),
    });

    expect(host.start({host: true}).ok).toBe(true);
    guest.start({host: false});
    await flush(host, guest);
    expect(guest.getBootstrapPhase()).toBe("local-save-failed");

    const pendingRetry = guest.retryLocalSave();
    await retryStarted;
    expect(deliverGuestUpdate(new Uint8Array(16 * 1024 * 1024 + 1))).toBe(false);
    expect(guest.getBootstrapPhase()).toBe("invalid-project");
    const frozenDiagnostics = guest.getDiagnostics();
    const frozenState = guest.getState();
    const frozenEncodedState = guest.domain.encodeState();
    const frozenEventCount = stateEvents.length;

    releaseRetry();
    await pendingRetry;

    expect(guest.getBootstrapPhase()).toBe("invalid-project");
    expect(guest.getDiagnostics()).toEqual(frozenDiagnostics);
    expect(guest.getState()).toEqual(frozenState);
    expect(guest.domain.encodeState()).toEqual(frozenEncodedState);
    expect(stateEvents).toHaveLength(frozenEventCount);
  });

  it("ignores queued remote updates after leave without changing idle state", () => {
    const mesh = createMemoryMesh();
    let deliverRemoteUpdate!: (update: Uint8Array) => boolean;
    const create = (config: CollabProviderConfig) => {
      deliverRemoteUpdate = config.applyRemoteUpdate;
      return createCollabProvider({
        doc: config.doc,
        secret: config.secret,
        transport: mesh.createTransport(),
        participantId: config.participantId,
        applyRemoteUpdate: config.applyRemoteUpdate,
        isLocalOrigin: config.isLocalOrigin,
      });
    };
    const stateEvents: string[] = [];
    const vm = fakeVm(project([stage()]));
    const guest = createCollabSession({
      roomId: "room-inactive-queued-update",
      secret: "inactive-queued-update-secret-inactive",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: vm.materializeLocal,
      applyRemoteToLocal: vm.applyRemoteToLocal,
      onState: state => stateEvents.push(state.bootstrapPhase),
    });
    guest.start({host: false});
    guest.leave();
    const frozenDiagnostics = guest.getDiagnostics();
    const frozenState = guest.domain.encodeState();
    const frozenEventCount = stateEvents.length;
    const queuedRemote = new Y.Doc();
    queuedRemote.getMap("queued").set("after-leave", true);

    expect(deliverRemoteUpdate(Y.encodeStateAsUpdate(queuedRemote))).toBe(false);

    expect(guest.getBootstrapPhase()).toBe("idle");
    expect(guest.getDiagnostics()).toEqual(frozenDiagnostics);
    expect(guest.domain.encodeState()).toEqual(frozenState);
    expect(stateEvents).toHaveLength(frozenEventCount);
  });

  it("does not stall immediately on empty peers before any peer is seen", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const guest = createCollabSession({
      roomId: "room-empty-peers-before-seen",
      secret: "empty-peers-before-seen-secret-empty1",
      debounceMs: 0,
      stallInactivityMs: 10_000,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    guest.start({host: false});
    expect(guest.getBootstrapPhase()).toBe("receiving-project");
    guest.provider.disconnect();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(guest.getBootstrapPhase()).not.toBe("stalled-project");
    expect(guest.getDiagnostics().sawPeerDuringBootstrap).toBe(false);
    expect(guest.getDiagnostics().status).toBe("connected");
  });

  it("auto-reconnects a host when signaling drops while waiting for guests", async () => {
    let connects = 0;
    const mesh = createMemoryMesh();
    const create = (config: CollabProviderConfig) => {
      const provider = createCollabProvider({
        doc: config.doc,
        secret: config.secret,
        transport: mesh.createTransport(),
        participantId: config.participantId,
        applyRemoteUpdate: config.applyRemoteUpdate,
        isLocalOrigin: config.isLocalOrigin,
      });
      const connect = provider.connect.bind(provider);
      provider.connect = () => {
        connects += 1;
        connect();
      };
      return provider;
    };
    const host = createCollabSession({
      roomId: "room-host-auto-reconnect",
      secret: "host-auto-reconnect-secret-host-auto",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    host.start({host: true});
    expect(host.getBootstrapPhase()).toBe("ready");
    expect(connects).toBe(1);

    host.provider.disconnect();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(connects).toBe(2);
    expect(host.provider.getStatus()).toBe("connected");
    expect(host.getBootstrapPhase()).toBe("ready");
  });

  it("reconnectBootstrap force-cycles transport after a peer departure stall", async () => {
    let connects = 0;
    let disconnects = 0;
    const mesh = createMemoryMesh();
    const create = (config: CollabProviderConfig) => {
      const provider = createCollabProvider({
        doc: config.doc,
        secret: config.secret,
        transport: mesh.createTransport(),
        participantId: config.participantId,
        applyRemoteUpdate: config.applyRemoteUpdate,
        isLocalOrigin: config.isLocalOrigin,
      });
      const connect = provider.connect.bind(provider);
      const disconnect = provider.disconnect.bind(provider);
      provider.connect = () => {
        connects += 1;
        connect();
      };
      provider.disconnect = () => {
        disconnects += 1;
        disconnect();
      };
      return provider;
    };
    const source = project([stage(), sprite("s1", "S1")]);
    const common = {
      roomId: "room-reconnect-force-cycle",
      secret: "reconnect-force-cycle-secret-reconnect",
      debounceMs: 0,
    };
    const host = createCollabSession({
      ...common,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: fakeVm(source).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    const guest = createCollabSession({
      ...common,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    host.start({host: true});
    guest.start({host: false});
    host.leave();
    await flush(guest);
    expect(guest.getBootstrapPhase()).toBe("stalled-project");
    expect(guest.getDiagnostics().sawPeerDuringBootstrap).toBe(true);

    const connectsBefore = connects;
    const disconnectsBefore = disconnects;
    guest.reconnectBootstrap();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(guest.getBootstrapPhase()).toBe("receiving-project");
    expect(disconnects).toBe(disconnectsBefore + 1);
    expect(connects).toBe(connectsBefore + 1);
    expect(guest.provider.getStatus()).toBe("connected");
  });
});

describe("guest staging guard lifecycle", () => {
  it("releases staging resources when a guest becomes ready and when it leaves", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    const host = createCollabSession({
      roomId: "room-staging-lifecycle",
      secret: "staging-lifecycle-secret-staging-lifecycle",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: fakeVm(source).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    const guestVm = fakeVm(project([stage()]));
    const guest = createCollabSession({
      roomId: "room-staging-lifecycle",
      secret: "staging-lifecycle-secret-staging-lifecycle",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: guestVm.materializeLocal,
      applyRemoteToLocal: guestVm.applyRemoteToLocal,
    });
    const releaseSpy = vi.spyOn(
      guest.domain,
      "releaseStagingGuardResources",
    );

    expect(host.start({host: true}).ok).toBe(true);
    guest.start({host: false});
    await flush(host, guest);

    expect(guest.getBootstrapPhase()).toBe("ready");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    guest.leave();
    expect(releaseSpy).toHaveBeenCalledTimes(2);
  });

  it("revalidates newer staged state before retrying a failed local save", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const hostVm = fakeVm(project([stage(), sprite("s1", "Original")]));
    const guestVm = fakeVm(project([stage()]));
    let failGuestSave = true;
    const host = createCollabSession({
      roomId: "room-retry-latest-staging",
      secret: "retry-latest-staging-secret-retry-latest",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: hostVm.materializeLocal,
      applyRemoteToLocal: hostVm.applyRemoteToLocal,
    });
    const guest = createCollabSession({
      roomId: "room-retry-latest-staging",
      secret: "retry-latest-staging-secret-retry-latest",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: guestVm.materializeLocal,
      applyRemoteToLocal: async (document, assets, context) => {
        if (failGuestSave) throw new Error("initial local save failed");
        return guestVm.applyRemoteToLocal(document, assets, context);
      },
    });

    expect(host.start({host: true}).ok).toBe(true);
    guest.start({host: false});
    await flush(host, guest);
    expect(guest.getBootstrapPhase()).toBe("local-save-failed");

    hostVm.editTargetName("s1", "NewerWhileSaveFailed");
    host.noteLocalChange();
    await flush(host, guest);
    expect(guest.getBootstrapPhase()).toBe("local-save-failed");

    failGuestSave = false;
    await guest.retryLocalSave();

    expect(guest.getBootstrapPhase()).toBe("ready");
    expect(guestVm.current().targets.find(target => target.id === "s1")?.name)
      .toBe("NewerWhileSaveFailed");
  });

  it("rolls back guest-initial when staging becomes awaiting-newer-seal during save", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const hostVm = fakeVm(project([stage(), sprite("s1", "Original")]));
    const previousGuestProject = project([stage(), sprite("local", "KeepMe")]);
    const guestVm = fakeVm(previousGuestProject);
    let markFirstSaveStarted!: () => void;
    let releaseFirstSave!: () => void;
    const firstSaveStarted = new Promise<void>(resolve => {
      markFirstSaveStarted = resolve;
    });
    const firstSaveGate = new Promise<void>(resolve => {
      releaseFirstSave = resolve;
    });
    const host = createCollabSession({
      roomId: "room-rollback-awaiting-seal",
      secret: "rollback-awaiting-seal-secret-rollback-await",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: hostVm.materializeLocal,
      applyRemoteToLocal: hostVm.applyRemoteToLocal,
    });
    const guest = createCollabSession({
      roomId: "room-rollback-awaiting-seal",
      secret: "rollback-awaiting-seal-secret-rollback-await",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: guestVm.materializeLocal,
      applyRemoteToLocal: async (document, assets, context) => {
        markFirstSaveStarted();
        await firstSaveGate;
        guestVm.applyRemoteToLocal(document, assets, context);
        return true;
      },
      rollbackGuestInitialLocal: () => guestVm.rollbackGuestInitialLocal(),
    });

    expect(host.start({host: true}).ok).toBe(true);
    guest.start({host: false});
    await host.provider.flush();
    await guest.provider.flush();
    const initialFlush = guest.flush();
    await firstSaveStarted;

    // Dirty staging content without a newer seal → awaiting-newer-seal after apply.
    const targetEntry = guest.domain.ydoc
      .getMap<Y.Map<unknown>>("targets")
      .get("s1");
    expect(targetEntry).toBeInstanceOf(Y.Map);
    const rawJson = targetEntry!.get("metadataJson");
    expect(typeof rawJson).toBe("string");
    const parsed = JSON.parse(String(rawJson)) as {name: string};
    parsed.name = "UnsealedDirty";
    guest.domain.ydoc.transact(() => {
      targetEntry!.set("metadataJson", JSON.stringify(parsed));
    }, "test-unsealed-dirty");

    releaseFirstSave();
    await initialFlush;

    expect(guest.getBootstrapPhase()).toBe("receiving-project");
    expect(guestVm.current().targets.find(target => target.id === "local")?.name)
      .toBe("KeepMe");
    expect(guestVm.rollbackCount()).toBe(1);
  });

  it("serializes newer staging state behind an in-flight initial local copy", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const hostVm = fakeVm(project([stage(), sprite("s1", "Original")]));
    const guestVm = fakeVm(project([stage()]));
    let markFirstSaveStarted!: () => void;
    let releaseFirstSave!: () => void;
    const firstSaveStarted = new Promise<void>(resolve => {
      markFirstSaveStarted = resolve;
    });
    const firstSaveGate = new Promise<void>(resolve => {
      releaseFirstSave = resolve;
    });
    const appliedModes: string[] = [];
    let applyAttempt = 0;
    const host = createCollabSession({
      roomId: "room-serialized-bootstrap-save",
      secret: "serialized-bootstrap-save-secret-serialized",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: hostVm.materializeLocal,
      applyRemoteToLocal: hostVm.applyRemoteToLocal,
    });
    const guest = createCollabSession({
      roomId: "room-serialized-bootstrap-save",
      secret: "serialized-bootstrap-save-secret-serialized",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: guestVm.materializeLocal,
      applyRemoteToLocal: async (document, assets, context) => {
        applyAttempt += 1;
        appliedModes.push(context.mode);
        if (applyAttempt === 1) {
          markFirstSaveStarted();
          await firstSaveGate;
        }
        guestVm.applyRemoteToLocal(document, assets, context);
      },
      rollbackGuestInitialLocal: () => guestVm.rollbackGuestInitialLocal(),
    });

    expect(host.start({host: true}).ok).toBe(true);
    guest.start({host: false});
    await host.provider.flush();
    await guest.provider.flush();
    const initialFlush = guest.flush();
    await firstSaveStarted;

    hostVm.editTargetName("s1", "NewerDuringInitialSave");
    host.noteLocalChange();
    await host.flush();
    await guest.provider.flush();
    await guest.flush();

    releaseFirstSave();
    await initialFlush;

    expect(guest.getBootstrapPhase()).toBe("ready");
    expect(guestVm.current().targets.find(target => target.id === "s1")?.name)
      .toBe("NewerDuringInitialSave");
    expect(appliedModes).toEqual(["guest-initial", "update"]);
  });

  it("keeps reconciling when staging changes during the follow-up update", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const hostVm = fakeVm(project([stage(), sprite("s1", "Original")]));
    const guestVm = fakeVm(project([stage()]));
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstStarted = new Promise<void>(resolve => {
      markFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>(resolve => {
      markSecondStarted = resolve;
    });
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });
    const modes: string[] = [];
    let attempt = 0;
    const host = createCollabSession({
      roomId: "room-looped-bootstrap-save",
      secret: "looped-bootstrap-save-secret-looped-save",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: hostVm.materializeLocal,
      applyRemoteToLocal: hostVm.applyRemoteToLocal,
    });
    const guest = createCollabSession({
      roomId: "room-looped-bootstrap-save",
      secret: "looped-bootstrap-save-secret-looped-save",
      debounceMs: 0,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: guestVm.materializeLocal,
      applyRemoteToLocal: async (document, assets, context) => {
        attempt += 1;
        modes.push(context.mode);
        if (attempt === 1) {
          markFirstStarted();
          await firstGate;
        } else if (attempt === 2) {
          markSecondStarted();
          await secondGate;
        }
        guestVm.applyRemoteToLocal(document, assets, context);
      },
      rollbackGuestInitialLocal: () => guestVm.rollbackGuestInitialLocal(),
    });

    expect(host.start({host: true}).ok).toBe(true);
    guest.start({host: false});
    await host.provider.flush();
    await guest.provider.flush();
    const initialFlush = guest.flush();
    await firstStarted;

    hostVm.editTargetName("s1", "Second");
    host.noteLocalChange();
    await host.flush();
    await guest.provider.flush();
    await guest.flush();
    releaseFirst();
    await secondStarted;

    hostVm.editTargetName("s1", "Third");
    host.noteLocalChange();
    await host.flush();
    await guest.provider.flush();
    await guest.flush();
    releaseSecond();
    await initialFlush;

    expect(guest.getBootstrapPhase()).toBe("ready");
    expect(guestVm.current().targets.find(target => target.id === "s1")?.name)
      .toBe("Third");
    expect(modes).toEqual(["guest-initial", "update", "update"]);
    expect(guestVm.rollbackCount()).toBe(0);
  });
});

describe("two-session convergence over WebRTC transport", () => {
  it("does not report ready when guest application cancels the session", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    const hostVm = fakeVm(source);
    const guestVm = fakeVm(project([stage()]));
    const common = {
      roomId: "room-canceled-guest",
      secret: "canceled-guest-secret-canceled-guest-1",
      debounceMs: 0,
    };
    const states: string[] = [];
    const host = createCollabSession({
      ...common,
      participantId: "peer-a",
      createProvider: create,
      materializeLocal: hostVm.materializeLocal,
      applyRemoteToLocal: hostVm.applyRemoteToLocal,
    });
    let guest!: CollabSession;
    guest = createCollabSession({
      ...common,
      participantId: "peer-b",
      createProvider: create,
      materializeLocal: guestVm.materializeLocal,
      applyRemoteToLocal: () => {
        guest.leave();
        return false;
      },
      onState: state => states.push(state.bootstrapPhase),
    });

    host.start({host: true});
    guest.start({host: false});
    await flush(host, guest);

    expect(guest.getBootstrapPhase()).toBe("idle");
    expect(states.at(-1)).toBe("idle");
    expect(states.slice(states.lastIndexOf("idle") + 1)).not.toContain("ready");
  });

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

    expect(a.start({host: true}).ok).toBe(true);
    b.start({host: false});
    await flush(a, b);

    expect(vmB.lastApplied()?.targets.map((t) => t.id).sort()).toEqual(["s1", "s2", "stage"]);

    vmA.editTargetName("s1", "EditedByA");
    a.noteLocalChange();
    vmB.editTargetName("s2", "EditedByB");
    b.noteLocalChange();
    await flush(a, b);

    const nameIn = (vm: ReturnType<typeof fakeVm>, id: string) =>
      vm.current().targets.find((t) => t.id === id)?.name;
    await flush(a, b);
    expect(vmA.lastApplied()?.targets.find((t) => t.id === "s2")?.name).toBe("EditedByB");
    expect(vmB.lastApplied()?.targets.find((t) => t.id === "s1")?.name).toBe("EditedByA");
    expect(nameIn(vmA, "s1")).toBe("EditedByA");
  });

  it("defers a new sprite until costume bytes exist, then syncs both peers", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    const vmA = fakeVm(source);
    const vmB = fakeVm(source);
    const common = {
      roomId: "room-sprite-asset",
      secret: "sprite-asset-secret-sprite-asset-1234",
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

    const baseball = sprite("bb", "Baseball");
    vmB.addTarget(baseball, false);
    b.noteLocalChange();
    await flush(a, b);
    expect(vmA.current().targets.some(target => target.id === "bb")).toBe(false);

    vmB.putAsset(baseball.costumes![0]!.md5ext, SPRITE_BYTES);
    await new Promise(resolve => setTimeout(resolve, 500));
    await flush(a, b);

    expect(vmA.lastApplied()?.targets.some(target => target.id === "bb")).toBe(true);
    const materialized = a.domain.materialize();
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) throw new Error("expected materialize ok");
    expect(materialized.assets.has(baseball.costumes![0]!.md5ext)).toBe(true);
  });

  it("publishes a new sprite and its costume bytes atomically", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    const vmA = fakeVm(source);
    const vmB = fakeVm(source);
    const common = {
      roomId: "room-sprite-atomic",
      secret: "sprite-atomic-secret-sprite-atomic-12",
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

    const baseball = sprite("bb", "Baseball");
    const costumeMd5 = baseball.costumes![0]!.md5ext;
    let remoteTransactions = 0;
    a.domain.ydoc.on("afterTransaction", (transaction) => {
      if (transaction.local) return;
      if (transaction.changedParentTypes.size === 0) return;
      remoteTransactions += 1;
      // Atomic publish: the first time Baseball appears, costume bytes must too.
      if (a.domain.ydoc.getMap("targets").has("bb")) {
        const mid = a.domain.materialize();
        expect(mid.ok).toBe(true);
        if (mid.ok) expect(mid.assets.has(costumeMd5)).toBe(true);
      }
    });

    vmB.addTarget(baseball, true);
    b.noteLocalChange();
    await flush(a, b);

    expect(remoteTransactions).toBe(1);
    expect(vmA.lastApplied()?.targets.some(target => target.id === "bb")).toBe(true);
    const materialized = a.domain.materialize();
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) throw new Error("expected materialize ok");
    expect(materialized.assets.has(costumeMd5)).toBe(true);
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

  it("converges concurrent same-section edits without leaving one VM stale", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    const vmA = fakeVm(source);
    const vmB = fakeVm(source);
    const common = {
      roomId: "room-same-target-pending",
      secret: "same-target-pending-secret-same-target",
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
      debounceMs: 200,
      participantId: "peer-b",
      createProvider: create,
      materializeLocal: vmB.materializeLocal,
      applyRemoteToLocal: vmB.applyRemoteToLocal,
    });

    a.start({host: true});
    b.start({host: false});
    await flush(a, b);

    // B starts a mid-edit snapshot (forever with only one body block, conceptually).
    vmB.editTargetName("s1", "IncompleteStack");
    b.noteLocalChange();
    // A finishes the stack and publishes first.
    vmA.editTargetName("s1", "CompleteStack");
    a.noteLocalChange();
    await new Promise(resolve => setTimeout(resolve, 20));
    await flush(a, b);
    // B's debounce would have republished IncompleteStack over CompleteStack.
    await new Promise(resolve => setTimeout(resolve, 220));
    await flush(a, b);

    const nameA = vmA.current().targets.find(target => target.id === "s1")?.name;
    const nameB = vmB.current().targets.find(target => target.id === "s1")?.name;
    expect(nameA).toBe(nameB);
    expect(["CompleteStack", "IncompleteStack"]).toContain(nameA);
    const materializeA = a.domain.materialize();
    expect(materializeA.ok).toBe(true);
    if (materializeA.ok) {
      expect(materializeA.document.targets.find(t => t.id === "s1")?.name)
        .toBe(nameA);
    }
  });

  it("keeps a stronger forever nest pending instead of letting a weaker remote win", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const block = (
      id: string,
      partial: Record<string, unknown>,
    ): NonNullable<ScratchTarget["blocks"]>[string] =>
      ({id, inputs: {}, fields: {}, shadow: false, ...partial}) as NonNullable<
        ScratchTarget["blocks"]
      >[string];
    const incompleteBlocks: ScratchTarget["blocks"] = {
      flag: block("flag", {
        opcode: "event_whenflagclicked",
        next: "forever",
        parent: null,
        topLevel: true,
      }),
      forever: block("forever", {
        opcode: "control_forever",
        next: null,
        parent: "flag",
        inputs: {SUBSTACK: [2, "turn"]},
        topLevel: false,
      }),
      turn: block("turn", {
        opcode: "motion_turnright",
        next: null,
        parent: "forever",
        topLevel: false,
      }),
      move: block("move", {
        opcode: "motion_movesteps",
        next: null,
        parent: null,
        topLevel: true,
      }),
    };
    const completeBlocks: ScratchTarget["blocks"] = {
      flag: block("flag", {
        opcode: "event_whenflagclicked",
        next: "forever",
        parent: null,
        topLevel: true,
      }),
      forever: block("forever", {
        opcode: "control_forever",
        next: null,
        parent: "flag",
        inputs: {SUBSTACK: [2, "turn"]},
        topLevel: false,
      }),
      turn: block("turn", {
        opcode: "motion_turnright",
        next: "move",
        parent: "forever",
        topLevel: false,
      }),
      move: block("move", {
        opcode: "motion_movesteps",
        next: null,
        parent: "turn",
        topLevel: false,
      }),
    };
    const source = project([stage(), sprite("s1", "S1")]);
    const vmA = fakeVm(source);
    const vmB = fakeVm(source);
    const common = {
      roomId: "room-forever-nest",
      secret: "forever-nest-secret-forever-nest-1234",
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
      // Long debounce so complete stays pending while the weaker remote arrives.
      debounceMs: 300,
      participantId: "peer-b",
      createProvider: create,
      materializeLocal: vmB.materializeLocal,
      applyRemoteToLocal: vmB.applyRemoteToLocal,
    });

    expect(a.start({host: true}).ok).toBe(true);
    expect(b.start({host: false}).ok).toBe(true);
    await flush(a, b);

    vmB.replaceTarget(sprite("s1", "S1", completeBlocks));
    b.noteLocalChange();

    // A publishes a weaker same-id graph while B's complete nest is still pending.
    vmA.replaceTarget(sprite("s1", "Detached", incompleteBlocks));
    a.noteLocalChange({force: true});
    await a.flush();
    await new Promise(resolve => setTimeout(resolve, 20));
    await flush(a, b);

    const nested = (target: ScratchTarget | undefined): boolean => {
      const forever = target?.blocks?.forever as
        | {inputs?: {SUBSTACK?: [number, string]}}
        | undefined;
      const move = target?.blocks?.move as
        | {parent?: string | null; topLevel?: boolean}
        | undefined;
      return forever?.inputs?.SUBSTACK?.[1] === "turn" &&
        move?.parent === "turn" &&
        move?.topLevel === false;
    };

    expect(nested(vmB.current().targets.find(target => target.id === "s1"))).toBe(true);
    expect(nested(vmA.current().targets.find(target => target.id === "s1"))).toBe(true);
    const materialize = a.domain.materialize();
    expect(materialize.ok).toBe(true);
    if (materialize.ok) {
      expect(nested(materialize.document.targets.find(t => t.id === "s1"))).toBe(true);
    }
  });

  it("lets a guest publish an intentional forever disconnect to the host", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const block = (
      id: string,
      partial: Record<string, unknown>,
    ): NonNullable<ScratchTarget["blocks"]>[string] =>
      ({id, inputs: {}, fields: {}, shadow: false, ...partial}) as NonNullable<
        ScratchTarget["blocks"]
      >[string];
    const connectedBlocks: ScratchTarget["blocks"] = {
      flag: block("flag", {
        opcode: "event_whenflagclicked",
        next: "goto",
        parent: null,
        topLevel: true,
      }),
      goto: block("goto", {
        opcode: "motion_goto",
        next: "forever",
        parent: "flag",
        topLevel: false,
      }),
      forever: block("forever", {
        opcode: "control_forever",
        next: null,
        parent: "goto",
        inputs: {SUBSTACK: [2, "turn"]},
        topLevel: false,
      }),
      turn: block("turn", {
        opcode: "motion_turnright",
        next: null,
        parent: "forever",
        topLevel: false,
      }),
    };
    const disconnectedBlocks: ScratchTarget["blocks"] = {
      flag: block("flag", {
        opcode: "event_whenflagclicked",
        next: "goto",
        parent: null,
        topLevel: true,
      }),
      goto: block("goto", {
        opcode: "motion_goto",
        next: null,
        parent: "flag",
        topLevel: false,
      }),
      forever: block("forever", {
        opcode: "control_forever",
        next: null,
        parent: null,
        inputs: {SUBSTACK: [2, "turn"]},
        topLevel: true,
      }),
      turn: block("turn", {
        opcode: "motion_turnright",
        next: null,
        parent: "forever",
        topLevel: false,
      }),
    };
    const source = project([stage(), sprite("s1", "S1", connectedBlocks)]);
    const vmHost = fakeVm(source);
    const vmGuest = fakeVm(source);
    const common = {
      roomId: "room-guest-disconnect",
      secret: "guest-disconnect-secret-guest-disc",
      debounceMs: 0,
    };
    const host = createCollabSession({
      ...common,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: vmHost.materializeLocal,
      applyRemoteToLocal: vmHost.applyRemoteToLocal,
    });
    const guest = createCollabSession({
      ...common,
      debounceMs: 300,
      participantId: "peer-guest",
      createProvider: create,
      materializeLocal: vmGuest.materializeLocal,
      applyRemoteToLocal: vmGuest.applyRemoteToLocal,
    });

    expect(host.start({host: true}).ok).toBe(true);
    expect(guest.start({host: false}).ok).toBe(true);
    await flush(host, guest);

    vmGuest.replaceTarget(sprite("s1", "S1", disconnectedBlocks));
    guest.noteLocalChange();

    // A coordinate-only host write arrives while the intentional detach is
    // pending. The detach must survive and the coordinate must also converge.
    vmHost.replaceTarget({...sprite("s1", "S1", connectedBlocks), x: 42});
    host.noteLocalChange({force: true});
    await flush(host, guest);
    await new Promise(resolve => setTimeout(resolve, 1_050));
    await flush(host, guest);

    const foreverDetached = (target: ScratchTarget | undefined): boolean => {
      const forever = target?.blocks?.forever as
        | {parent?: string | null; topLevel?: boolean}
        | undefined;
      const goto = target?.blocks?.goto as {next?: string | null} | undefined;
      return forever?.parent == null &&
        forever?.topLevel === true &&
        (goto?.next == null || goto.next === "");
    };

    expect(foreverDetached(vmGuest.current().targets.find(t => t.id === "s1"))).toBe(true);
    expect(foreverDetached(vmHost.current().targets.find(t => t.id === "s1"))).toBe(true);
    expect(vmGuest.current().targets.find(t => t.id === "s1")?.x).toBe(42);
    expect(vmHost.current().targets.find(t => t.id === "s1")?.x).toBe(42);
    const shared = host.domain.materialize();
    expect(shared.ok).toBe(true);
    if (shared.ok) {
      const sharedTarget = shared.document.targets.find(t => t.id === "s1");
      expect(foreverDetached(sharedTarget)).toBe(true);
      expect(sharedTarget?.x).toBe(42);
    }
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

describe("creator-only Drive writes", () => {
  it("allows only the room creator to persist to Drive", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const source = project([stage(), sprite("s1", "S1")]);
    const common = {roomId: "room-2", secret: "secret-secret-secret-secret-secret-1", debounceMs: 0};

    const a = createCollabSession({...common, participantId: "peer-a", createProvider: create, materializeLocal: fakeVm(source).materializeLocal, applyRemoteToLocal: () => {}});
    const b = createCollabSession({...common, participantId: "peer-b", createProvider: create, materializeLocal: fakeVm(project([stage()])).materializeLocal, applyRemoteToLocal: () => {}});

    a.start({host: true});
    b.start({host: false});
    await flush(a, b);

    expect(a.createdThisRoom()).toBe(true);
    expect(a.canPersistToDrive().ok).toBe(true);
    expect(b.canPersistToDrive().ok).toBe(false);
    expect(b.canPersistToDrive({explicit: true}).ok).toBe(false);
  });

  it("does not grant Drive writes when the creator leaves", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const common = {roomId: "room-3", secret: "another-secret-another-secret-abc12", debounceMs: 0};
    const a = createCollabSession({...common, participantId: "peer-a", createProvider: create, materializeLocal: fakeVm(project([stage()])).materializeLocal, applyRemoteToLocal: () => {}});
    const b = createCollabSession({...common, participantId: "peer-b", createProvider: create, materializeLocal: fakeVm(project([stage()])).materializeLocal, applyRemoteToLocal: () => {}});

    a.start({host: true});
    b.start({host: false});
    await flush(a, b);

    a.leave();
    await flush(b);
    expect(b.isLeader()).toBe(true);
    expect(b.canPersistToDrive().ok).toBe(false);
  });

  it("blocks background Drive writes while transport is disconnected", async () => {
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
    expect(session.canPersistToDrive({explicit: true}).ok).toBe(true);
  });

  it("keeps leadership reobserve as diagnostics-only for Drive authorization", async () => {
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
    // Guest still cannot write Drive even after becoming diagnostic leader.
    expect(b.canPersistToDrive().ok).toBe(false);
    releaseObservation();
    await observation;
    await flush(b);
    expect(b.canPersistToDrive().ok).toBe(false);
  });

  it("does not reobserve Drive when the initial host becomes leader", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const reobserve = vi.fn(async () => undefined);
    const session = createCollabSession({
      roomId: "room-host",
      secret: "host-secret-host-secret-host-secret",
      debounceMs: 0,
      participantId: "peer-host",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
      reobserveDriveBeforeLeadership: reobserve,
    });

    session.start({host: true});
    await flush(session);

    expect(reobserve).not.toHaveBeenCalled();
    expect(session.isLeader()).toBe(true);
    expect(session.getState().conflict).toBe(false);
    expect(session.canPersistToDrive().ok).toBe(true);
  });

  it("does not reobserve when a guest briefly self-elects before seeing the host", async () => {
    const mesh = createMemoryMesh();
    const create = sessionFactory(mesh);
    const reobserve = vi.fn(async () => {
      throw new Error("should not run on guest join");
    });
    const common = {
      roomId: "room-guest-race",
      secret: "guest-race-secret-guest-race-secret",
      debounceMs: 0,
    };
    const host = createCollabSession({
      ...common,
      participantId: "peer-a",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
    });
    const guest = createCollabSession({
      ...common,
      participantId: "peer-b",
      createProvider: create,
      materializeLocal: fakeVm(project([stage()])).materializeLocal,
      applyRemoteToLocal: () => {},
      reobserveDriveBeforeLeadership: reobserve,
    });

    guest.start({host: false});
    await flush(guest);
    host.start({host: true});
    await flush(host, guest);

    expect(reobserve).not.toHaveBeenCalled();
    expect(guest.isLeader()).toBe(false);
    expect(guest.getState().conflict).toBe(false);
    expect(guest.getState().role).toBe("follower");
  });
});

describe("conflict handling stops automatic Drive saves", () => {
  it("refuses background writes after conflict but allows explicit creator save", async () => {
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
    expect(session.canPersistToDrive({explicit: true}).ok).toBe(true);
    expect(session.getState().conflict).toBe(true);
    session.clearDriveConflict();
    expect(session.getState().conflict).toBe(false);
    expect(session.canPersistToDrive().ok).toBe(true);
    expect(vm.current().targets.some((t) => t.id === "s1")).toBe(true);
  });
});
