import {describe, expect, it, vi} from "vitest";
import * as Y from "yjs";
import type {
  CostumeRef,
  ProjectDocument,
  ScratchTarget,
} from "@blocksync/project-schema";
import {
  DEFAULT_PROJECT_COLLAB_LIMITS,
  LOCAL_ORIGIN,
  ProjectCollaborationDocument,
  diffBlocks,
} from "./project-collab.js";
// Existing Gate 0 API must remain exported and intact.
import {CollaborationDocument} from "./index.js";

function costume(
  name = "c1",
  assetId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
): CostumeRef {
  return {
    kind: "costume",
    name,
    assetId,
    md5ext: `${assetId}.svg`,
    dataFormat: "svg",
    contentSha256: "b".repeat(64),
    rotationCenterX: 0,
    rotationCenterY: 0,
  };
}

function stage(overrides: Partial<ScratchTarget> = {}): ScratchTarget {
  return {
    id: "stage",
    name: "Stage",
    isStage: true,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume("backdrop1", "cccccccccccccccccccccccccccccccc")],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
    ...overrides,
  };
}

function sprite(id = "s1", overrides: Partial<ScratchTarget> = {}): ScratchTarget {
  const assetId = `${id}${"a".repeat(32 - id.length)}`;
  return {
    id,
    name: `Sprite-${id}`,
    isStage: false,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume(`${id}-c`, assetId)],
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
    ...overrides,
  };
}

function project(targets: ScratchTarget[]): ProjectDocument {
  return {schemaVersion: 2, targets, extensions: [], monitors: [], meta: {}};
}

function assetsFor(document: ProjectDocument): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const target of document.targets) {
    for (const c of target.costumes ?? []) {
      map.set(c.md5ext, new Uint8Array([1, 2, 3, 4]));
    }
    for (const s of target.sounds ?? []) {
      map.set(s.md5ext, new Uint8Array([5, 6, 7, 8]));
    }
  }
  return map;
}

describe("ProjectCollaborationDocument materialization", () => {
  it("round-trips a schema 2 project and its content-addressed assets", () => {
    const doc = new ProjectCollaborationDocument();
    const source = project([stage(), sprite("s1"), sprite("s2")]);
    doc.loadLocalProject(source, assetsFor(source));

    const result = doc.materialize();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(2);
    expect(result.document.targets.map((t) => t.id).sort()).toEqual([
      "s1",
      "s2",
      "stage",
    ]);
    expect(result.document.targets[0]!.isStage).toBe(true);
    expect(result.assets.size).toBe(3);
    for (const bytes of result.assets.values()) {
      expect(bytes).toBeInstanceOf(Uint8Array);
    }
  });

  it("does not store the whole project as a single last-write-wins blob", () => {
    const doc = new ProjectCollaborationDocument();
    const source = project([stage(), sprite("s1")]);
    doc.loadLocalProject(source, assetsFor(source));
    // Target sections are independent Yjs registers: metadata-only events
    // cannot replace the block graph of the same sprite.
    const targetsRoot = doc.ydoc.getMap<Y.Map<unknown>>("targets");
    expect(targetsRoot.has("stage")).toBe(true);
    expect(targetsRoot.has("s1")).toBe(true);
    const spriteEntry = targetsRoot.get("s1")!;
    expect(spriteEntry.get("metadataJson")).toEqual(expect.any(String));
    expect(spriteEntry.get("blocks")).toBeInstanceOf(Y.Map);
    expect(spriteEntry.has("blocksJson")).toBe(false);
    expect(spriteEntry.has("json")).toBe(false);
  });

  it("propagates target deletion through Yjs updates", () => {
    const source = project([stage(), sprite("s1")]);
    const sender = new ProjectCollaborationDocument();
    const receiver = new ProjectCollaborationDocument();
    sender.loadLocalProject(source, assetsFor(source));
    receiver.applyRemoteUpdate(sender.encodeState());

    sender.deleteTarget("s1");
    receiver.applyRemoteUpdate(
      Y.encodeStateAsUpdate(sender.ydoc, Y.encodeStateVector(receiver.ydoc)),
    );

    const result = receiver.materialize();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.targets.map(target => target.id)).toEqual(["stage"]);
    }
  });
});

describe("different-target concurrent merge", () => {
  it("merges edits made to different targets on two peers", () => {
    const source = project([stage(), sprite("s1"), sprite("s2")]);
    const a = new ProjectCollaborationDocument();
    a.loadLocalProject(source, assetsFor(source));
    const b = new ProjectCollaborationDocument();
    b.applyRemoteUpdate(a.encodeState());

    a.setTarget(sprite("s1", {name: "EditedByA"}));
    b.setTarget(sprite("s2", {name: "EditedByB"}));

    // Exchange concurrent updates both ways.
    const ua = a.encodeState();
    const ub = b.encodeState();
    a.applyRemoteUpdate(ub);
    b.applyRemoteUpdate(ua);

    const ra = a.materialize();
    const rb = b.materialize();
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    const nameA = (id: string, r: typeof ra) =>
      r.document.targets.find((t) => t.id === id)!.name;
    expect(nameA("s1", ra)).toBe("EditedByA");
    expect(nameA("s2", ra)).toBe("EditedByB");
    expect(nameA("s1", rb)).toBe("EditedByA");
    expect(nameA("s2", rb)).toBe("EditedByB");
  });
});

describe("same-target section conflict semantics", () => {
  it("resolves concurrent same-target edits to a single deterministic value", () => {
    const source = project([stage(), sprite("s1")]);
    const a = new ProjectCollaborationDocument();
    a.loadLocalProject(source, assetsFor(source));
    const b = new ProjectCollaborationDocument();
    b.applyRemoteUpdate(a.encodeState());

    a.setTarget(sprite("s1", {name: "NameA"}));
    b.setTarget(sprite("s1", {name: "NameB"}));
    a.applyRemoteUpdate(b.encodeState());
    b.applyRemoteUpdate(a.encodeState());

    const ra = a.materialize();
    const rb = b.materialize();
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    const na = ra.document.targets.find((t) => t.id === "s1")!.name;
    const nb = rb.document.targets.find((t) => t.id === "s1")!.name;
    // Documented: concurrent writes to the same target section are LWW.
    expect(na).toBe(nb);
    expect(["NameA", "NameB"]).toContain(na);
  });

  it("preserves a block edit when a peer concurrently moves the same sprite", () => {
    const source = project([stage(), sprite("s1")]);
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    ydocA.clientID = 1;
    ydocB.clientID = 2;
    const a = new ProjectCollaborationDocument(ydocA);
    a.loadLocalProject(source, assetsFor(source));
    const b = new ProjectCollaborationDocument(ydocB);
    b.applyRemoteUpdate(a.encodeState());

    a.setTarget(sprite("s1", {
      blocks: {
        flag: {
          id: "flag",
          opcode: "event_whenflagclicked",
          next: null,
          parent: null,
          inputs: {},
          fields: {},
          shadow: false,
          topLevel: true,
          x: 20,
          y: 20,
        },
      },
    }));
    const shared = b.getTarget("s1")!;
    const {blocks: _ignored, ...sharedMeta} = shared;
    b.applyTargetPatch("s1", {
      metadata: {...sharedMeta, x: 42},
    });

    const updateA = a.encodeState();
    const updateB = b.encodeState();
    a.applyRemoteUpdate(updateB);
    b.applyRemoteUpdate(updateA);

    for (const peer of [a, b]) {
      const result = peer.materialize();
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const target = result.document.targets.find(item => item.id === "s1")!;
      expect(target.x).toBe(42);
      expect(target.blocks.flag).toBeDefined();
    }
  });
});

describe("feedback-loop prevention via origin tracking", () => {
  it("notifies remote changes but not local edits", () => {
    const source = project([stage(), sprite("s1")]);
    const a = new ProjectCollaborationDocument();
    a.loadLocalProject(source, assetsFor(source));
    const b = new ProjectCollaborationDocument();
    b.applyRemoteUpdate(a.encodeState());

    const remoteSpy = vi.fn();
    a.onRemoteChange(remoteSpy);

    a.setTarget(sprite("s1", {name: "LocalOnly"}));
    expect(remoteSpy).not.toHaveBeenCalled();

    b.setTarget(sprite("s1", {name: "FromB"}));
    a.applyRemoteUpdate(b.encodeState());
    expect(remoteSpy).toHaveBeenCalled();
  });
});

describe("remote state acceptance guards", () => {
  it("accepts incomplete bootstrap state without requiring materialization", () => {
    const incomplete = new Y.Doc();
    const target = new Y.Map<unknown>();
    target.set("id", "stage");
    incomplete.getMap<Y.Map<unknown>>("targets").set("stage", target);
    const update = Y.encodeStateAsUpdate(incomplete);
    const receiver = new ProjectCollaborationDocument();

    const outcome = receiver.tryApplyStagingUpdate(
      update,
      update.byteLength + 128,
    );

    expect(outcome.accepted).toBe(true);
    expect(receiver.ydoc.getMap("targets").has("stage")).toBe(true);
    expect(receiver.materialize().ok).toBe(false);
  });

  it("does not reject when mergeUpdates exceeds the limit but encodeStateAsUpdate does not", () => {
    const sender = new Y.Doc();
    sender.clientID = 1;
    const values = sender.getMap<string>("values");
    const receiverDoc = new Y.Doc();
    receiverDoc.clientID = 2;
    const receiver = new ProjectCollaborationDocument(receiverDoc);
    // Fixed client IDs make the i=4 state deterministic: mergeUpdates is 244
    // bytes while encodeStateAsUpdate is 209 bytes. A 225-byte limit must use
    // the exact encoded state and accept it.
    const hardLimit = 225;
    let senderVector = Y.encodeStateVector(sender);
    let sawMergeOverEncodeUnder = false;

    for (let i = 0; i < 12; i += 1) {
      values.set(`k${i}`, "x".repeat(30 + (i % 20)));
      if (i % 5 === 4) values.delete(`k${i - 1}`);
      const update = Y.encodeStateAsUpdate(sender, senderVector);
      senderVector = Y.encodeStateVector(sender);
      expect(update.byteLength).toBeLessThan(hardLimit);

      const before = receiver.encodeState();
      const novel = Y.diffUpdate(update, Y.encodeStateVector(receiver.ydoc));
      const merged = Y.mergeUpdates([before, novel]);
      const trial = new Y.Doc();
      Y.applyUpdate(trial, before);
      Y.applyUpdate(trial, novel);
      const encodedAfter = Y.encodeStateAsUpdate(trial).byteLength;
      trial.destroy();
      const outcome = receiver.tryApplyStagingUpdate(update, hardLimit);

      if (merged.byteLength > hardLimit && encodedAfter <= hardLimit) {
        sawMergeOverEncodeUnder = true;
        expect(outcome.accepted).toBe(true);
        expect(receiver.encodeState().byteLength).toBeLessThanOrEqual(hardLimit);
        break;
      }
      if (encodedAfter > hardLimit) {
        expect(outcome.accepted).toBe(false);
        break;
      }
      expect(outcome.accepted).toBe(true);
    }

    expect(sawMergeOverEncodeUnder).toBe(true);
  });

  it("rejects individually-small updates that cumulatively exceed the staging limit without changing live state", () => {
    const sender = new Y.Doc();
    const values = sender.getMap<string>("values");

    values.set("first", "a".repeat(128));
    const firstUpdate = Y.encodeStateAsUpdate(sender);
    const firstVector = Y.encodeStateVector(sender);
    values.set("second", "b".repeat(128));
    const secondUpdate = Y.encodeStateAsUpdate(sender, firstVector);
    const cumulativeState = Y.encodeStateAsUpdate(sender);
    const hardLimit = Math.max(firstUpdate.byteLength, secondUpdate.byteLength) + 8;

    expect(firstUpdate.byteLength).toBeLessThan(hardLimit);
    expect(secondUpdate.byteLength).toBeLessThan(hardLimit);
    expect(cumulativeState.byteLength).toBeGreaterThan(hardLimit);

    const receiver = new ProjectCollaborationDocument();
    expect(receiver.tryApplyStagingUpdate(firstUpdate, hardLimit).accepted).toBe(true);
    const beforeRejectedUpdate = receiver.encodeState();

    const outcome = receiver.tryApplyStagingUpdate(secondUpdate, hardLimit);

    expect(outcome.accepted).toBe(false);
    expect(receiver.encodeState()).toEqual(beforeRejectedUpdate);
    expect(receiver.ydoc.getMap("values").has("second")).toBe(false);
  });

  it("does not repeatedly encode near-limit staging state for duplicate small frames", () => {
    const sender = new Y.Doc();
    const values = sender.getMap<string>("values");
    values.set("base", "x".repeat(2_048));
    const baseUpdate = Y.encodeStateAsUpdate(sender);
    const baseVector = Y.encodeStateVector(sender);
    values.set("small", "ok");
    const smallUpdate = Y.encodeStateAsUpdate(sender, baseVector);
    const smallVector = Y.encodeStateVector(sender);
    const stateAfterSmall = Y.encodeStateAsUpdate(sender);
    values.set("overflow", "z".repeat(128));
    const overflowUpdate = Y.encodeStateAsUpdate(sender, smallVector);
    const stateAfterOverflow = Y.encodeStateAsUpdate(sender);
    const hardLimit = stateAfterSmall.byteLength + 8;

    expect(baseUpdate.byteLength).toBeLessThan(hardLimit);
    expect(smallUpdate.byteLength).toBeLessThan(hardLimit);
    expect(overflowUpdate.byteLength).toBeLessThan(hardLimit);
    expect(stateAfterOverflow.byteLength).toBeGreaterThan(hardLimit);

    const receiver = new ProjectCollaborationDocument();
    expect(receiver.tryApplyStagingUpdate(baseUpdate, hardLimit).accepted).toBe(true);
    expect(receiver.tryApplyStagingUpdate(smallUpdate, hardLimit).accepted).toBe(true);
    const acceptedState = Y.encodeStateAsUpdate(receiver.ydoc);
    const encodeSpy = vi.spyOn(receiver, "encodeState");

    for (let i = 0; i < 20; i += 1) {
      expect(receiver.tryApplyStagingUpdate(smallUpdate, hardLimit).accepted).toBe(true);
    }
    expect(encodeSpy).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(receiver.ydoc)).toEqual(acceptedState);

    expect(receiver.tryApplyStagingUpdate(overflowUpdate, hardLimit).accepted).toBe(false);
    encodeSpy.mockClear();
    for (let i = 0; i < 20; i += 1) {
      expect(receiver.tryApplyStagingUpdate(overflowUpdate, hardLimit).accepted).toBe(false);
    }
    expect(encodeSpy).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(receiver.ydoc)).toEqual(acceptedState);
  });

  it("uses one initial full encode for a stream of distinct small staging frames", () => {
    const sender = new Y.Doc();
    const values = sender.getMap<string>("values");
    const receiver = new ProjectCollaborationDocument();
    const encodeSpy = vi.spyOn(receiver, "encodeState");
    let senderVector = Y.encodeStateVector(sender);

    for (let i = 0; i < 20; i += 1) {
      values.set(`key-${i}`, `value-${i}`);
      const update = Y.encodeStateAsUpdate(sender, senderVector);
      senderVector = Y.encodeStateVector(sender);
      expect(update.byteLength).toBeLessThan(4_096);
      expect(receiver.tryApplyStagingUpdate(update, 4_096).accepted).toBe(true);
    }

    expect(encodeSpy).toHaveBeenCalledTimes(1);
    expect(receiver.ydoc.getMap("values").size).toBe(20);
  });

  it("caches distinct raw deletion frames by their identical semantic diff", () => {
    const sender = new Y.Doc();
    const values = sender.getMap<string>("values");
    values.set("keep", "x".repeat(2_048));
    values.set("delete-me", "y".repeat(128));
    const vectors: Uint8Array[] = [];
    for (let i = 0; i < 20; i += 1) {
      vectors.push(Y.encodeStateVector(sender));
      values.set(`extra-${i}`, `value-${i}`);
    }
    values.delete("delete-me");

    const rawFrames = vectors.map(vector =>
      Y.encodeStateAsUpdate(sender, vector),
    );
    const receiverDoc = new Y.Doc();
    Y.applyUpdate(receiverDoc, Y.encodeStateAsUpdate(sender));
    const receiver = new ProjectCollaborationDocument(receiverDoc);
    const hardLimit = receiver.encodeState().byteLength + 4;
    const semanticDiffs = rawFrames.map(frame =>
      Y.diffUpdate(frame, Y.encodeStateVector(receiverDoc)),
    );

    expect(new Set(rawFrames.map(frame => Array.from(frame).join(","))).size)
      .toBe(rawFrames.length);
    for (const diff of semanticDiffs.slice(1)) {
      expect(diff).toEqual(semanticDiffs[0]);
    }
    expect(semanticDiffs[0]!.byteLength).toBeGreaterThan(2);
    expect(receiver.tryApplyStagingUpdate(new Uint8Array([0, 0]), hardLimit).accepted)
      .toBe(true);
    const exactMergeSpy = vi.spyOn(
      receiver as unknown as {
        replaceStagingUpdateChunks(update: Uint8Array): void;
      },
      "replaceStagingUpdateChunks",
    );

    for (const frame of rawFrames) {
      expect(receiver.tryApplyStagingUpdate(frame, hardLimit).accepted).toBe(true);
    }

    expect(exactMergeSpy).toHaveBeenCalledTimes(1);
  });

  it("releases staging resources and stops maintaining them for later updates", () => {
    const receiver = new ProjectCollaborationDocument();
    const staged = new Y.Doc();
    staged.getMap("values").set("staged", "value");
    expect(receiver.tryApplyStagingUpdate(Y.encodeStateAsUpdate(staged), 1_024).accepted)
      .toBe(true);
    const appendSpy = vi.spyOn(
      receiver as unknown as {
        appendStagingUpdateChunk(update: Uint8Array): void;
      },
      "appendStagingUpdateChunk",
    );

    receiver.releaseStagingGuardResources();
    appendSpy.mockClear();
    receiver.ydoc.getMap("values").set("later", "edit");

    expect(appendSpy).not.toHaveBeenCalled();
    expect(receiver.tryApplyStagingUpdate(new Uint8Array([0, 0]), 1_024).accepted)
      .toBe(false);
  });

  it("does not repopulate staging resources after reentrant release during apply", () => {
    const receiver = new ProjectCollaborationDocument();
    const staged = new Y.Doc();
    staged.getMap("values").set("staged", "value");
    receiver.ydoc.on("update", () => {
      receiver.releaseStagingGuardResources();
    });

    const outcome = receiver.tryApplyStagingUpdate(
      Y.encodeStateAsUpdate(staged),
      1_024,
    );
    const internals = receiver as unknown as {
      stagingNovelByteUpperBound: number | null;
      stagingUpdateChunks: Map<number, Uint8Array> | null;
      stagingRawResultCache: Map<string, unknown>;
      stagingSemanticResultCache: Map<string, unknown>;
    };

    expect(outcome.accepted).toBe(true);
    expect(internals.stagingNovelByteUpperBound).toBeNull();
    expect(internals.stagingUpdateChunks).toBeNull();
    expect(internals.stagingRawResultCache.size).toBe(0);
    expect(internals.stagingSemanticResultCache.size).toBe(0);
    expect(receiver.tryApplyStagingUpdate(new Uint8Array([0, 0]), 1_024).accepted)
      .toBe(false);
  });

  it("rejects a remote update whose materialized project is schema-invalid", () => {
    const source = project([stage(), sprite("s1")]);
    const good = new ProjectCollaborationDocument();
    good.loadLocalProject(source, assetsFor(source));
    const receiver = new ProjectCollaborationDocument();
    receiver.applyRemoteUpdate(good.encodeState());

    // Craft a malicious doc: sprite with zero costumes (invalid on schema 2).
    const evil = new Y.Doc();
    Y.applyUpdate(evil, good.encodeState());
    const targets = evil.getMap<Y.Map<unknown>>("targets");
    evil.transact(() => {
      const t = targets.get("s1")!;
      const {blocks: _blocks, ...metadata} = sprite("s1", {costumes: []});
      t.set("metadataJson", JSON.stringify(metadata));
    });
    const update = Y.encodeStateAsUpdate(evil);

    const outcome = receiver.tryApplyRemoteUpdate(update);
    expect(outcome.accepted).toBe(false);
    // Receiver keeps its previously valid state.
    expect(receiver.materialize().ok).toBe(true);
  });

  it("rejects remote state that exceeds the asset byte limit", () => {
    const source = project([stage(), sprite("s1")]);
    const good = new ProjectCollaborationDocument();
    good.loadLocalProject(source, assetsFor(source));
    const receiver = new ProjectCollaborationDocument();
    receiver.applyRemoteUpdate(good.encodeState());

    const evil = new Y.Doc();
    Y.applyUpdate(evil, good.encodeState());
    const assets = evil.getMap<Uint8Array>("assets");
    evil.transact(() => {
      assets.set(
        "cccccccccccccccccccccccccccccccc.svg",
        new Uint8Array(DEFAULT_PROJECT_COLLAB_LIMITS.maxAssetBytes + 1),
      );
    });
    const outcome = receiver.tryApplyRemoteUpdate(Y.encodeStateAsUpdate(evil));
    expect(outcome.accepted).toBe(false);
  });

  it("rejects remote state carrying forbidden prototype-polluting keys", () => {
    const source = project([stage(), sprite("s1")]);
    const good = new ProjectCollaborationDocument();
    good.loadLocalProject(source, assetsFor(source));
    const receiver = new ProjectCollaborationDocument();
    receiver.applyRemoteUpdate(good.encodeState());

    const evil = new Y.Doc();
    Y.applyUpdate(evil, good.encodeState());
    const targets = evil.getMap<Y.Map<unknown>>("targets");
    evil.transact(() => {
      const t = targets.get("s1")!;
      t.set(
        "metadataJson",
        '{"id":"s1","__proto__":{"polluted":true}}',
      );
    });
    const outcome = receiver.tryApplyRemoteUpdate(Y.encodeStateAsUpdate(evil));
    expect(outcome.accepted).toBe(false);
  });

  it("rejects forbidden keys in project metadata", () => {
    const source = project([stage()]);
    const doc = new ProjectCollaborationDocument();
    doc.loadLocalProject(source, assetsFor(source));
    doc.ydoc.getMap("meta").set(
      "meta",
      '{"nested":{"constructor":{"polluted":true}}}',
    );

    const result = doc.materialize();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_DOCUMENT",
          path: "document.meta.nested.constructor",
        }),
      ]));
    }
  });
});

describe("content-addressed assets", () => {
  it("is idempotent for repeated identical asset writes", () => {
    const doc = new ProjectCollaborationDocument();
    const source = project([stage(), sprite("s1")]);
    doc.loadLocalProject(source, assetsFor(source));
    const before = doc.materialize();
    doc.putAsset("cccccccccccccccccccccccccccccccc.svg", new Uint8Array([1, 2, 3, 4]));
    const after = doc.materialize();
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.assets.size).toBe(before.assets.size);
  });

  it("publishes assets and targets in one local transaction", () => {
    const doc = new ProjectCollaborationDocument();
    const source = project([stage(), sprite("s1")]);
    doc.loadLocalProject(source, assetsFor(source));
    const baseball = sprite("bb");
    const costumeBytes = new Uint8Array([9, 8, 7, 6]);
    let localTransactions = 0;
    doc.ydoc.on("afterTransaction", (transaction: Y.Transaction) => {
      if (transaction.origin !== LOCAL_ORIGIN) return;
      if (transaction.changedParentTypes.size === 0) return;
      localTransactions += 1;
    });
    localTransactions = 0;
    doc.putAssetsAndSetTargets(
      [baseball],
      [[baseball.costumes![0]!.md5ext, costumeBytes]],
    );
    expect(localTransactions).toBe(1);
    const result = doc.materialize();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.targets.some(target => target.id === "bb")).toBe(true);
    expect(result.assets.get(baseball.costumes![0]!.md5ext)).toEqual(costumeBytes);
  });

  it("soft-accepts a remote target that arrives before its assets", () => {
    const source = project([stage(), sprite("s1")]);
    const host = new ProjectCollaborationDocument();
    host.loadLocalProject(source, assetsFor(source));
    const peer = new ProjectCollaborationDocument();
    peer.applyRemoteUpdate(host.encodeState());

    const baseball = sprite("bb");
    const costumeMd5 = baseball.costumes![0]!.md5ext;
    const costumeBytes = new Uint8Array([9, 8, 7, 6]);
    host.setTarget(baseball);
    const targetOnly = Y.encodeStateAsUpdate(host.ydoc, Y.encodeStateVector(peer.ydoc));
    expect(peer.tryApplyRemoteUpdate(targetOnly).accepted).toBe(true);
    expect(peer.materialize().ok).toBe(false);

    host.putAsset(costumeMd5, costumeBytes);
    const assetUpdate = Y.encodeStateAsUpdate(host.ydoc, Y.encodeStateVector(peer.ydoc));
    expect(peer.tryApplyRemoteUpdate(assetUpdate).accepted).toBe(true);
    const result = peer.materialize();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets.has(costumeMd5)).toBe(true);
    expect(result.document.targets.some(target => target.id === "bb")).toBe(true);
  });

  it("still rejects schema-invalid remote updates after soft-accepting missing assets", () => {
    const source = project([stage(), sprite("s1")]);
    const good = new ProjectCollaborationDocument();
    good.loadLocalProject(source, assetsFor(source));
    const receiver = new ProjectCollaborationDocument();
    receiver.applyRemoteUpdate(good.encodeState());

    const evil = new Y.Doc();
    Y.applyUpdate(evil, good.encodeState());
    const targets = evil.getMap<Y.Map<unknown>>("targets");
    evil.transact(() => {
      const t = targets.get("s1")!;
      const {blocks: _blocks, ...metadata} = sprite("s1", {costumes: []});
      t.set("metadataJson", JSON.stringify(metadata));
    });
    const outcome = receiver.tryApplyRemoteUpdate(Y.encodeStateAsUpdate(evil));
    expect(outcome.accepted).toBe(false);
    expect(receiver.materialize().ok).toBe(true);
  });
});

function topBlock(
  id: string,
  opcode: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    opcode,
    next: null,
    parent: null,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: true,
    x: 10,
    y: 10,
    ...overrides,
  };
}

describe("block-level Phase 1 convergence", () => {
  it("merges concurrent new stacks on the same sprite", () => {
    const source = project([stage(), sprite("s1")]);
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    ydocA.clientID = 1;
    ydocB.clientID = 2;
    const a = new ProjectCollaborationDocument(ydocA);
    a.loadLocalProject(source, assetsFor(source));
    const b = new ProjectCollaborationDocument(ydocB);
    b.applyRemoteUpdate(a.encodeState());

    a.applyTargetPatch("s1", {
      blocks: {upserts: {stackA: topBlock("stackA", "event_whenflagclicked")}, deletes: []},
    });
    b.applyTargetPatch("s1", {
      blocks: {
        upserts: {stackB: topBlock("stackB", "event_whenkeypressed", {x: 200})},
        deletes: [],
      },
    });

    a.applyRemoteUpdate(b.encodeState());
    b.applyRemoteUpdate(a.encodeState());

    for (const peer of [a, b]) {
      const result = peer.materialize();
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const blocks = result.document.targets.find(t => t.id === "s1")!.blocks;
      expect(blocks.stackA).toBeDefined();
      expect(blocks.stackB).toBeDefined();
    }
  });

  it("applies a baseline delete alongside a concurrent unknown remote add", () => {
    const source = project([
      stage(),
      sprite("s1", {
        blocks: {
          keep: topBlock("keep", "event_whenflagclicked") as unknown as ScratchTarget["blocks"][string],
          doomed: topBlock("doomed", "motion_movesteps", {x: 40}) as unknown as ScratchTarget["blocks"][string],
        },
      }),
    ]);
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    ydocA.clientID = 1;
    ydocB.clientID = 2;
    const a = new ProjectCollaborationDocument(ydocA);
    a.loadLocalProject(source, assetsFor(source));
    const b = new ProjectCollaborationDocument(ydocB);
    b.applyRemoteUpdate(a.encodeState());

    const baseline = {
      keep: topBlock("keep", "event_whenflagclicked"),
      doomed: topBlock("doomed", "motion_movesteps", {x: 40}),
    };
    a.applyTargetPatch("s1", {
      blocks: diffBlocks(baseline, {keep: baseline.keep}),
    });
    b.applyTargetPatch("s1", {
      blocks: {
        upserts: {remoteOnly: topBlock("remoteOnly", "event_whenkeypressed", {x: 120})},
        deletes: [],
      },
    });

    a.applyRemoteUpdate(b.encodeState());
    b.applyRemoteUpdate(a.encodeState());

    for (const peer of [a, b]) {
      const result = peer.materialize();
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const blocks = result.document.targets.find(t => t.id === "s1")!.blocks;
      expect(blocks.keep).toBeDefined();
      expect(blocks.doomed).toBeUndefined();
      expect(blocks.remoteOnly).toBeDefined();
    }
  });

  it("does not delete an unknown remote block when publishing a stale local snapshot diff", () => {
    const source = project([
      stage(),
      sprite("s1", {
        blocks: {
          keep: topBlock("keep", "event_whenflagclicked") as unknown as ScratchTarget["blocks"][string],
        },
      }),
    ]);
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    ydocA.clientID = 1;
    ydocB.clientID = 2;
    const a = new ProjectCollaborationDocument(ydocA);
    a.loadLocalProject(source, assetsFor(source));
    const b = new ProjectCollaborationDocument(ydocB);
    b.applyRemoteUpdate(a.encodeState());

    // B adds a new stack that A has not observed yet.
    b.applyTargetPatch("s1", {
      blocks: {
        upserts: {remoteOnly: topBlock("remoteOnly", "event_whenkeypressed", {x: 120})},
        deletes: [],
      },
    });

    // Stale A still thinks baseline is only `keep`. Diff against that baseline
    // must not emit a delete for remoteOnly.
    const staleLocal = {
      keep: topBlock("keep", "event_whenflagclicked"),
      localNew: topBlock("localNew", "control_forever", {x: 40, y: 80}),
    };
    const baseline = {keep: topBlock("keep", "event_whenflagclicked")};
    const patch = diffBlocks(baseline, staleLocal);
    expect(patch.deletes).toEqual([]);
    expect(patch.upserts.localNew).toBeDefined();

    a.applyTargetPatch("s1", {blocks: patch});
    a.applyRemoteUpdate(
      Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)),
    );
    b.applyRemoteUpdate(
      Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)),
    );

    for (const peer of [a, b]) {
      const result = peer.materialize();
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const blocks = result.document.targets.find(t => t.id === "s1")!.blocks;
      expect(blocks.keep).toBeDefined();
      expect(blocks.localNew).toBeDefined();
      expect(blocks.remoteOnly).toBeDefined();
    }
  });

  it("converges same-block concurrent edits to one deterministic winner", () => {
    const source = project([
      stage(),
      sprite("s1", {
        blocks: {
          shared: topBlock("shared", "event_whenflagclicked") as unknown as ScratchTarget["blocks"][string],
        },
      }),
    ]);
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    ydocA.clientID = 1;
    ydocB.clientID = 2;
    const a = new ProjectCollaborationDocument(ydocA);
    a.loadLocalProject(source, assetsFor(source));
    const b = new ProjectCollaborationDocument(ydocB);
    b.applyRemoteUpdate(a.encodeState());

    a.applyTargetPatch("s1", {
      blocks: {
        upserts: {
          shared: topBlock("shared", "event_whenflagclicked", {
            fields: {VALUE: ["A", null]},
          }),
        },
        deletes: [],
      },
    });
    b.applyTargetPatch("s1", {
      blocks: {
        upserts: {
          shared: topBlock("shared", "event_whenflagclicked", {
            fields: {VALUE: ["B", null]},
          }),
        },
        deletes: [],
      },
    });

    a.applyRemoteUpdate(b.encodeState());
    b.applyRemoteUpdate(a.encodeState());

    const ra = a.materialize();
    const rb = b.materialize();
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    const blockA = ra.document.targets.find(t => t.id === "s1")!.blocks.shared;
    const blockB = rb.document.targets.find(t => t.id === "s1")!.blocks.shared;
    expect(blockA).toEqual(blockB);
    const value = (blockA as unknown as {fields: {VALUE: [string, null]}}).fields.VALUE[0];
    expect(["A", "B"]).toContain(value);
  });

  it("reads legacy blocksJson and fail-closes mixed representations", () => {
    const doc = new ProjectCollaborationDocument();
    const source = project([stage(), sprite("s1")]);
    doc.loadLocalProject(source, assetsFor(source));

    const legacy = new Y.Doc();
    Y.applyUpdate(legacy, doc.encodeState());
    const targets = legacy.getMap<Y.Map<unknown>>("targets");
    legacy.transact(() => {
      const entry = targets.get("s1")!;
      entry.delete("blocks");
      entry.set(
        "blocksJson",
        JSON.stringify({
          legacyStack: topBlock("legacyStack", "event_whenflagclicked"),
        }),
      );
    });
    const legacyDoc = new ProjectCollaborationDocument(legacy);
    const legacyResult = legacyDoc.materialize();
    expect(legacyResult.ok).toBe(true);
    if (legacyResult.ok) {
      expect(
        legacyResult.document.targets.find(t => t.id === "s1")!.blocks.legacyStack,
      ).toBeDefined();
    }

    const mixed = new Y.Doc();
    Y.applyUpdate(mixed, doc.encodeState());
    mixed.transact(() => {
      const entry = mixed.getMap<Y.Map<unknown>>("targets").get("s1")!;
      entry.set("blocksJson", JSON.stringify({}));
    });
    const mixedDoc = new ProjectCollaborationDocument(mixed);
    const mixedResult = mixedDoc.materialize();
    expect(mixedResult.ok).toBe(false);
    if (!mixedResult.ok) {
      expect(mixedResult.issues.some(i =>
        i.message.includes("mixed blocks representation"),
      )).toBe(true);
    }
  });

  it("rejects cyclic remote block graphs without mutating the live doc", () => {
    const good = new ProjectCollaborationDocument();
    const source = project([stage(), sprite("s1")]);
    good.loadLocalProject(source, assetsFor(source));
    const receiver = new ProjectCollaborationDocument();
    receiver.applyRemoteUpdate(good.encodeState());

    const evil = new Y.Doc();
    Y.applyUpdate(evil, good.encodeState());
    evil.transact(() => {
      const entry = evil.getMap<Y.Map<unknown>>("targets").get("s1")!;
      const blocks = entry.get("blocks") as Y.Map<string>;
      blocks.set(
        "a",
        JSON.stringify(topBlock("a", "control_forever", {next: "b", topLevel: true})),
      );
      blocks.set(
        "b",
        JSON.stringify(
          topBlock("b", "motion_movesteps", {
            next: "a",
            parent: "a",
            topLevel: false,
          }),
        ),
      );
    });

    const outcome = receiver.tryApplyRemoteUpdate(Y.encodeStateAsUpdate(evil));
    expect(outcome.accepted).toBe(false);
    expect(receiver.materialize().ok).toBe(true);
  });
});

describe("Gate 0 CollaborationDocument remains available", () => {
  it("still exports and validates sprite ops", () => {
    const doc = new CollaborationDocument();
    expect(doc.materialize().targets.some((t) => t.id === "stage")).toBe(true);
  });
});
