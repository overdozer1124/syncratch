import {describe, expect, it, vi} from "vitest";
import * as Y from "yjs";
import type {
  CostumeRef,
  ProjectDocument,
  ScratchTarget,
} from "@blocksync/project-schema";
import {
  DEFAULT_PROJECT_COLLAB_LIMITS,
  ProjectCollaborationDocument,
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
    // Target-granular storage: a per-target key exists in the shared map.
    const targetsRoot = doc.ydoc.getMap("targets");
    expect(targetsRoot.has("stage")).toBe(true);
    expect(targetsRoot.has("s1")).toBe(true);
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

describe("same-target conflict semantics (documented)", () => {
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
    // Documented: same-target writes are last-write-wins and converge.
    expect(na).toBe(nb);
    expect(["NameA", "NameB"]).toContain(na);
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
    const values = sender.getMap<string>("values");
    const receiver = new ProjectCollaborationDocument();
    const hardLimit = 250;
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
      t.set("json", JSON.stringify(sprite("s1", {costumes: []})));
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
        "json",
        '{"id":"s1","__proto__":{"polluted":true},"blocks":{}}',
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
});

describe("Gate 0 CollaborationDocument remains available", () => {
  it("still exports and validates sprite ops", () => {
    const doc = new CollaborationDocument();
    expect(doc.materialize().targets.some((t) => t.id === "stage")).toBe(true);
  });
});
