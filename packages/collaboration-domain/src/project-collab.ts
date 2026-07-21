/**
 * @experimental Local-First project collaboration model (schema 2).
 *
 * The shared Y.Doc stores project state at TARGET granularity, not as a single
 * last-write-wins JSON blob:
 *   - `meta`    : Y.Map with schemaVersion, extensions, monitors, and meta.
 *   - `targets` : Y.Map keyed by target id; each value is a per-target Y.Map
 *                 whose `json` holds the canonical ScratchTarget.
 *   - `assets`  : Y.Map keyed by content-address md5ext; each value is the raw
 *                 Uint8Array. Because keys are content addresses, identical
 *                 asset writes converge without conflict.
 *
 * Concurrent edits to DIFFERENT targets merge (distinct keys). Concurrent edits
 * to the SAME target are last-write-wins on that target's `json` and converge to
 * a single deterministic value (see docs/CONFLICTS below). This is intentional
 * and is NOT distributed locking.
 *
 * Origin tracking: local edits transact under LOCAL_ORIGIN and remote updates
 * apply under REMOTE_ORIGIN, so callers can bind VM -> Yjs and Yjs -> VM without
 * feedback loops (onRemoteChange never fires for local edits).
 */

import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import * as Y from "yjs";
import {
  validateProject,
  type ProjectDocument,
  type ScratchTarget,
  type ValidationIssue,
} from "@blocksync/project-schema";

export const LOCAL_ORIGIN: unique symbol = Symbol("blocksync-collab-local");
export const REMOTE_ORIGIN: unique symbol = Symbol("blocksync-collab-remote");

export interface ProjectCollabLimits {
  /** Maximum canonical JSON byte length of the materialized document. */
  maxProjectBytes: number;
  /** Maximum number of content-addressed assets. */
  maxAssetCount: number;
  /** Maximum total asset bytes (mirrors the 5 MiB SB3 boundary). */
  maxAssetBytes: number;
  /** Maximum size of any single asset. */
  maxSingleAssetBytes: number;
}

export const DEFAULT_PROJECT_COLLAB_LIMITS: ProjectCollabLimits = {
  maxProjectBytes: 5 * 1024 * 1024,
  maxAssetCount: 200,
  maxAssetBytes: 5 * 1024 * 1024,
  maxSingleAssetBytes: 5 * 1024 * 1024,
};

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const KEY_SCAN_MAX_NODES = 200_000;
const KEY_SCAN_MAX_DEPTH = 128;
const STAGING_RAW_RESULT_CACHE_MAX = 64;
const STAGING_SEMANTIC_RESULT_CACHE_MAX = 128;
const STAGING_ORIGIN: unique symbol = Symbol("blocksync-collab-staging");

export interface MaterializeSuccess {
  ok: true;
  document: ProjectDocument;
  assets: Map<string, Uint8Array>;
}

export interface MaterializeFailure {
  ok: false;
  issues: ValidationIssue[];
}

export type MaterializeResult = MaterializeSuccess | MaterializeFailure;

export interface ApplyRemoteResult {
  accepted: boolean;
  issues?: ValidationIssue[];
}

function issue(code: string, message: string, path?: string): ValidationIssue {
  return {code: code as ValidationIssue["code"], message, path};
}

/** Reject prototype-polluting keys and non-plain nested objects. */
export function assertSafeKeys(
  value: unknown,
  issues: ValidationIssue[],
  path: string,
): void {
  const stack: Array<{value: unknown; depth: number; path: string}> = [
    {value, depth: 0, path},
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > KEY_SCAN_MAX_NODES) {
      issues.push(issue("INVALID_DOCUMENT", "remote target JSON node limit exceeded", current.path));
      return;
    }
    if (current.depth > KEY_SCAN_MAX_DEPTH) {
      issues.push(issue("INVALID_DOCUMENT", "remote target JSON depth limit exceeded", current.path));
      return;
    }
    const node = current.value;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        stack.push({value: node[i], depth: current.depth + 1, path: `${current.path}[${i}]`});
      }
      continue;
    }
    if (node !== null && typeof node === "object") {
      const prototype = Object.getPrototypeOf(node);
      if (prototype !== Object.prototype && prototype !== null) {
        issues.push(issue("INVALID_DOCUMENT", "remote target JSON has non-plain object", current.path));
        continue;
      }
      for (const key of Object.keys(node)) {
        if (FORBIDDEN_KEYS.has(key)) {
          issues.push(issue("INVALID_DOCUMENT", `forbidden key ${key}`, `${current.path}.${key}`));
          continue;
        }
        stack.push({
          value: (node as Record<string, unknown>)[key],
          depth: current.depth + 1,
          path: `${current.path}.${key}`,
        });
      }
    }
  }
}

function targetSortKey(target: ScratchTarget): [number, number, string] {
  return [target.isStage ? 0 : 1, target.layerOrder ?? 0, target.id];
}

export class ProjectCollaborationDocument {
  readonly ydoc: Y.Doc;
  private readonly limits: ProjectCollabLimits;
  private readonly meta: Y.Map<unknown>;
  private readonly targets: Y.Map<Y.Map<unknown>>;
  private readonly assets: Y.Map<Uint8Array>;
  private stagingNovelByteUpperBound: number | null = null;
  private stagingUpdateChunks: Map<number, Uint8Array> | null = null;
  private readonly stagingRawResultCache = new Map<string, ApplyRemoteResult>();
  private readonly stagingSemanticResultCache =
    new Map<string, ApplyRemoteResult>();
  private readonly stagingUpdateHandler: (
    encodedUpdate: Uint8Array,
    origin: unknown,
  ) => void;
  private stagingGuardReleased = false;

  constructor(ydoc = new Y.Doc(), limits: ProjectCollabLimits = DEFAULT_PROJECT_COLLAB_LIMITS) {
    this.ydoc = ydoc;
    this.limits = limits;
    this.meta = ydoc.getMap("meta");
    this.targets = ydoc.getMap<Y.Map<unknown>>("targets");
    this.assets = ydoc.getMap<Uint8Array>("assets");
    this.stagingUpdateHandler = (
      encodedUpdate: Uint8Array,
      origin: unknown,
    ): void => {
      if (origin === STAGING_ORIGIN) return;
      this.stagingRawResultCache.clear();
      this.stagingSemanticResultCache.clear();
      if (this.stagingNovelByteUpperBound !== null) {
        this.stagingNovelByteUpperBound += encodedUpdate.byteLength;
        this.appendStagingUpdateChunk(encodedUpdate);
      }
    };
    this.ydoc.on("update", this.stagingUpdateHandler);
  }

  private stagingCacheKey(
    kind: "raw" | "semantic",
    update: Uint8Array,
    maxStagingStateBytes: number,
  ): string {
    return `${kind}:${maxStagingStateBytes}:${bytesToHex(sha256(update))}`;
  }

  private rememberStagingResult(
    cache: Map<string, ApplyRemoteResult>,
    maxEntries: number,
    key: string,
    result: ApplyRemoteResult,
  ): ApplyRemoteResult {
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, result);
    return result;
  }

  private rememberRawAndSemanticStagingResult(
    rawKey: string,
    semanticKey: string,
    result: ApplyRemoteResult,
  ): ApplyRemoteResult {
    this.rememberStagingResult(
      this.stagingRawResultCache,
      STAGING_RAW_RESULT_CACHE_MAX,
      rawKey,
      result,
    );
    return this.rememberStagingResult(
      this.stagingSemanticResultCache,
      STAGING_SEMANTIC_RESULT_CACHE_MAX,
      semanticKey,
      result,
    );
  }

  private appendStagingUpdateChunk(update: Uint8Array): void {
    if (this.stagingUpdateChunks === null) {
      this.stagingUpdateChunks = new Map();
    }
    let chunk = update;
    let level = Math.floor(Math.log2(Math.max(1, chunk.byteLength)));
    while (true) {
      const existing = this.stagingUpdateChunks.get(level);
      if (!existing) {
        this.stagingUpdateChunks.set(level, chunk);
        return;
      }
      this.stagingUpdateChunks.delete(level);
      chunk = Y.mergeUpdates([existing, chunk]);
      level = Math.max(
        level + 1,
        Math.floor(Math.log2(Math.max(1, chunk.byteLength))),
      );
    }
  }

  private replaceStagingUpdateChunks(update: Uint8Array): void {
    this.stagingUpdateChunks = new Map();
    this.appendStagingUpdateChunk(update);
  }

  /**
   * Irreversibly release bootstrap-only limit state and its Y.Doc listener.
   * A collaboration session calls this whenever staging reaches a terminal
   * phase; subsequent staging updates are rejected.
   */
  releaseStagingGuardResources(): void {
    if (this.stagingGuardReleased) return;
    this.stagingGuardReleased = true;
    this.ydoc.off("update", this.stagingUpdateHandler);
    this.stagingNovelByteUpperBound = null;
    this.stagingUpdateChunks = null;
    this.stagingRawResultCache.clear();
    this.stagingSemanticResultCache.clear();
  }

  /** Seed the shared doc from a full local project (local origin). */
  loadLocalProject(document: ProjectDocument, assets: Map<string, Uint8Array>): void {
    this.ydoc.transact(() => {
      this.meta.set("schemaVersion", document.schemaVersion);
      this.meta.set("extensions", JSON.stringify(document.extensions ?? []));
      this.meta.set("monitors", JSON.stringify(document.monitors ?? []));
      this.meta.set("meta", JSON.stringify(document.meta ?? {}));
      for (const target of document.targets) {
        this.writeTarget(target);
      }
      for (const [md5ext, bytes] of assets) {
        this.assets.set(md5ext, bytes);
      }
    }, LOCAL_ORIGIN);
  }

  private writeTarget(target: ScratchTarget): void {
    let entry = this.targets.get(target.id);
    if (!entry) {
      entry = new Y.Map<unknown>();
      this.targets.set(target.id, entry);
    }
    entry.set("id", target.id);
    entry.set("json", JSON.stringify(target));
  }

  /** Update a single target locally (target-granular, local origin). */
  setTarget(target: ScratchTarget): void {
    this.ydoc.transact(() => {
      this.writeTarget(target);
    }, LOCAL_ORIGIN);
  }

  /** Delete a target locally and propagate the deletion to every peer. */
  deleteTarget(targetId: string): void {
    this.ydoc.transact(() => {
      this.targets.delete(targetId);
    }, LOCAL_ORIGIN);
  }

  /** Store an asset by its content address (local origin). Idempotent. */
  putAsset(md5ext: string, bytes: Uint8Array): void {
    this.ydoc.transact(() => {
      this.assets.set(md5ext, bytes);
    }, LOCAL_ORIGIN);
  }

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /** Apply a remote update unconditionally, marked with remote origin. */
  applyRemoteUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.ydoc, update, REMOTE_ORIGIN);
  }

  /**
   * Fire `callback` only for changes that did NOT originate locally. This lets a
   * caller push remote Yjs state into the VM without triggering VM -> Yjs -> VM
   * feedback. Returns an unsubscribe function.
   */
  onRemoteChange(callback: () => void): () => void {
    const handler = (transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      if (transaction.changedParentTypes.size === 0) return;
      callback();
    };
    this.ydoc.on("afterTransaction", handler);
    return () => this.ydoc.off("afterTransaction", handler);
  }

  /** Materialize + validate + limit-check the current shared state. */
  materialize(): MaterializeResult {
    return materializeAndValidate(this.ydoc, this.limits);
  }

  /**
   * Trial-apply a remote update on a clone, validate + limit-check, and only
   * commit to the live doc when acceptable. Corrupt/oversized remote state is
   * rejected and the live doc is left untouched.
   */
  tryApplyRemoteUpdate(update: Uint8Array): ApplyRemoteResult {
    const trial = new Y.Doc();
    try {
      Y.applyUpdate(trial, this.encodeState());
      Y.applyUpdate(trial, update);
      const result = materializeAndValidate(trial, this.limits);
      if (!result.ok) {
        return {accepted: false, issues: result.issues};
      }
      Y.applyUpdate(this.ydoc, update, REMOTE_ORIGIN);
      return {accepted: true};
    } catch (error) {
      return {
        accepted: false,
        issues: [
          issue(
            "INVALID_DOCUMENT",
            error instanceof Error ? error.message : String(error),
          ),
        ],
      };
    } finally {
      trial.destroy();
    }
  }

  /**
   * Accept a remote update into a staging document without requiring a complete
   * asset set. Novel-byte sums and mergeUpdates lengths are conservative upper
   * bounds only; the hard-limit decision uses encodeStateAsUpdate length.
   */
  tryApplyStagingUpdate(
    update: Uint8Array,
    maxStagingStateBytes = 16 * 1024 * 1024,
  ): ApplyRemoteResult {
    if (this.stagingGuardReleased) {
      return {
        accepted: false,
        issues: [issue("INVALID_DOCUMENT", "staging guard has been released")],
      };
    }
    if (update.byteLength > maxStagingStateBytes) {
      return {
        accepted: false,
        issues: [issue("INVALID_DOCUMENT", "decoded Yjs update exceeds hard limit")],
      };
    }
    const rawCacheKey = this.stagingCacheKey(
      "raw",
      update,
      maxStagingStateBytes,
    );
    const rawCached = this.stagingRawResultCache.get(rawCacheKey);
    if (rawCached) return rawCached;

    let semanticCacheKey: string | null = null;
    try {
      const novelUpdate = Y.diffUpdate(
        update,
        Y.encodeStateVector(this.ydoc),
      );
      semanticCacheKey = this.stagingCacheKey(
        "semantic",
        novelUpdate,
        maxStagingStateBytes,
      );
      const semanticCached =
        this.stagingSemanticResultCache.get(semanticCacheKey);
      if (semanticCached) {
        return this.rememberStagingResult(
          this.stagingRawResultCache,
          STAGING_RAW_RESULT_CACHE_MAX,
          rawCacheKey,
          semanticCached,
        );
      }
      const isDuplicate = novelUpdate.byteLength === 2 &&
        novelUpdate[0] === 0 &&
        novelUpdate[1] === 0;
      if (
        this.stagingNovelByteUpperBound === null ||
        this.stagingUpdateChunks === null
      ) {
        const currentState = this.encodeState();
        this.stagingNovelByteUpperBound = currentState.byteLength;
        this.replaceStagingUpdateChunks(currentState);
      }
      const stagingUpdateChunks = this.stagingUpdateChunks;
      if (stagingUpdateChunks === null) {
        throw new Error("staging update chunks were not initialized");
      }
      const projectedUpperBound = this.stagingNovelByteUpperBound +
        (isDuplicate ? 0 : novelUpdate.byteLength);

      if (projectedUpperBound <= maxStagingStateBytes) {
        if (!isDuplicate) {
          Y.applyUpdate(this.ydoc, novelUpdate, STAGING_ORIGIN);
          if (this.stagingGuardReleased) return {accepted: true};
          this.stagingNovelByteUpperBound = projectedUpperBound;
          this.appendStagingUpdateChunk(novelUpdate);
          this.stagingRawResultCache.clear();
          this.stagingSemanticResultCache.clear();
        }
        return this.rememberRawAndSemanticStagingResult(
          rawCacheKey,
          semanticCacheKey,
          {accepted: true},
        );
      }

      // Near the bound: mergeUpdates is only a conservative filter. When it
      // overshoots, measure the real encodeStateAsUpdate length on a trial doc.
      const mergedUpperBound = Y.mergeUpdates(
        isDuplicate
          ? [...stagingUpdateChunks.values()]
          : [...stagingUpdateChunks.values(), novelUpdate],
      );
      if (mergedUpperBound.byteLength > maxStagingStateBytes) {
        const trial = new Y.Doc();
        try {
          Y.applyUpdate(trial, this.encodeState());
          if (!isDuplicate) {
            Y.applyUpdate(trial, novelUpdate);
          }
          if (Y.encodeStateAsUpdate(trial).byteLength > maxStagingStateBytes) {
            return this.rememberRawAndSemanticStagingResult(
              rawCacheKey,
              semanticCacheKey,
              {
                accepted: false,
                issues: [issue("INVALID_DOCUMENT", "cumulative staging state exceeds hard limit")],
              },
            );
          }
        } finally {
          trial.destroy();
        }
      }
      if (!isDuplicate) {
        Y.applyUpdate(this.ydoc, novelUpdate, STAGING_ORIGIN);
        if (this.stagingGuardReleased) return {accepted: true};
        this.stagingRawResultCache.clear();
        this.stagingSemanticResultCache.clear();
      }
      const encodedState = this.encodeState();
      this.stagingNovelByteUpperBound = encodedState.byteLength;
      this.replaceStagingUpdateChunks(encodedState);
      return this.rememberRawAndSemanticStagingResult(
        rawCacheKey,
        semanticCacheKey,
        {accepted: true},
      );
    } catch (error) {
      this.stagingRawResultCache.clear();
      this.stagingSemanticResultCache.clear();
      const result: ApplyRemoteResult = {
        accepted: false,
        issues: [
          issue(
            "INVALID_DOCUMENT",
            error instanceof Error ? error.message : String(error),
          ),
        ],
      };
      if (semanticCacheKey !== null) {
        return this.rememberRawAndSemanticStagingResult(
          rawCacheKey,
          semanticCacheKey,
          result,
        );
      }
      return this.rememberStagingResult(
        this.stagingRawResultCache,
        STAGING_RAW_RESULT_CACHE_MAX,
        rawCacheKey,
        result,
      );
    }
  }
}

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function materializeAndValidate(
  ydoc: Y.Doc,
  limits: ProjectCollabLimits,
): MaterializeResult {
  const issues: ValidationIssue[] = [];
  const meta = ydoc.getMap("meta");
  const targetsRoot = ydoc.getMap<Y.Map<unknown>>("targets");
  const assetsRoot = ydoc.getMap<Uint8Array>("assets");

  const schemaVersion = typeof meta.get("schemaVersion") === "number"
    ? (meta.get("schemaVersion") as number)
    : 2;

  const targets: ScratchTarget[] = [];
  targetsRoot.forEach((entry, id) => {
    if (!(entry instanceof Y.Map)) {
      issues.push(issue("INVALID_DOCUMENT", "target entry is not a map", `targets.${id}`));
      return;
    }
    const raw = entry.get("json");
    if (typeof raw !== "string") {
      issues.push(issue("INVALID_DOCUMENT", "target json missing", `targets.${id}`));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      issues.push(issue("INVALID_DOCUMENT", "target json is not valid JSON", `targets.${id}`));
      return;
    }
    assertSafeKeys(parsed, issues, `targets.${id}`);
    targets.push(parsed as ScratchTarget);
  });

  if (issues.length > 0) {
    return {ok: false, issues};
  }

  targets.sort((a, b) => {
    const ka = targetSortKey(a);
    const kb = targetSortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });

  const document: ProjectDocument = {
    schemaVersion,
    targets,
    extensions: parseJsonField<string[]>(meta.get("extensions"), []),
    monitors: parseJsonField<unknown[]>(meta.get("monitors"), []),
    meta: parseJsonField<Record<string, unknown>>(meta.get("meta"), {}),
  };
  assertSafeKeys(document, issues, "document");

  // Assets: typed-array checks + count/byte limits + content-address integrity.
  const assets = new Map<string, Uint8Array>();
  let totalAssetBytes = 0;
  assetsRoot.forEach((bytes, md5ext) => {
    if (!(bytes instanceof Uint8Array)) {
      issues.push(issue("INVALID_ASSET_REF", "asset bytes must be a Uint8Array", `assets.${md5ext}`));
      return;
    }
    if (bytes.byteLength > limits.maxSingleAssetBytes) {
      issues.push(issue("INVALID_ASSET_REF", "asset exceeds single-asset byte limit", `assets.${md5ext}`));
      return;
    }
    totalAssetBytes += bytes.byteLength;
    assets.set(md5ext, bytes);
  });

  if (assets.size > limits.maxAssetCount) {
    issues.push(issue("INVALID_DOCUMENT", "asset count exceeds limit"));
  }
  if (totalAssetBytes > limits.maxAssetBytes) {
    issues.push(issue("INVALID_DOCUMENT", "total asset bytes exceed limit"));
  }

  // Every costume/sound must reference a present asset (content-addressed).
  for (const target of targets) {
    for (const costume of target.costumes ?? []) {
      if (!assets.has(costume.md5ext)) {
        issues.push(issue("MISSING_ASSET" as ValidationIssue["code"], `missing asset ${costume.md5ext}`, target.id));
      }
    }
    for (const sound of target.sounds ?? []) {
      if (!assets.has(sound.md5ext)) {
        issues.push(issue("MISSING_ASSET" as ValidationIssue["code"], `missing asset ${sound.md5ext}`, target.id));
      }
    }
  }

  const projectBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength;
  if (projectBytes > limits.maxProjectBytes) {
    issues.push(issue("INVALID_DOCUMENT", "project exceeds byte limit"));
  }

  if (issues.length > 0) {
    return {ok: false, issues};
  }

  const schemaResult = validateProject(document);
  if (!schemaResult.ok) {
    return {ok: false, issues: schemaResult.issues};
  }

  return {ok: true, document, assets};
}
