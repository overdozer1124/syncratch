/**
 * In-band collaboration bootstrap checkpoint (stage 1).
 *
 * The room creator seals a self-describing checkpoint into the shared Y.Doc
 * `bootstrap` map. Guests materialize from staging only after the latest seal
 * is contained, validated, and persisted as a new local project.
 */

import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {contentHash} from "@blocksync/project-envelope";
import {
  validateProject,
  type ProjectDocument,
  type ValidationIssue,
} from "@blocksync/project-schema";
import * as Y from "yjs";
import {
  assertSafeKeys,
  DEFAULT_PROJECT_COLLAB_LIMITS,
  type ProjectCollabLimits,
} from "./project-collab.js";

export type BootstrapState = "seeding" | "sealed";

export interface BootstrapAsset {
  md5ext: string;
  contentSha256: string;
  byteLength: number;
}

export interface BootstrapCheckpoint {
  bootstrapId: string;
  state: BootstrapState;
  projectTitle?: string;
  contentStateVector?: string;
  documentHash?: string;
  assetManifest?: BootstrapAsset[];
}

export type PreflightIssueCode =
  | "INVALID_DOCUMENT"
  | "MISSING_ASSET"
  | "ASSET_HASH_MISMATCH"
  | "ASSET_SIZE_MISMATCH"
  | "ASSET_COUNT_LIMIT"
  | "TOTAL_ASSET_BYTES_LIMIT"
  | "SINGLE_ASSET_BYTES_LIMIT"
  | "PROJECT_BYTES_LIMIT"
  | "SAFE_KEY_VIOLATION";

export interface PreflightIssue {
  code: PreflightIssueCode;
  message: string;
  path?: string;
}

export type HostPreflightResult =
  | {ok: true; documentHash: string; assetManifest: BootstrapAsset[]; projectTitle?: string}
  | {ok: false; issues: PreflightIssue[]};

export type CheckpointValidationStatus =
  | "incomplete-vector"
  | "awaiting-newer-seal"
  | "missing-assets"
  | "invalid"
  | "ready";

export interface CheckpointValidationResult {
  status: CheckpointValidationStatus;
  issues: PreflightIssue[];
  document?: ProjectDocument;
  assets?: Map<string, Uint8Array>;
  verifiedAssetCount: number;
  expectedAssetCount: number;
}

export const MAX_DECODED_UPDATE_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_TITLE_CODE_POINTS = 200;
export const COLLAB_FALLBACK_TITLE = "共同編集プロジェクト";

const BOOTSTRAP_MAP = "bootstrap";

function issue(
  code: PreflightIssueCode,
  message: string,
  path?: string,
): PreflightIssue {
  return {code, message, path};
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function bytesFromBase64Url(value: string): Uint8Array | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9\-_]+$/.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function normalizeProjectTitle(title: unknown): string {
  if (typeof title !== "string") return COLLAB_FALLBACK_TITLE;
  const trimmed = [...title].slice(0, MAX_PROJECT_TITLE_CODE_POINTS).join("").trim();
  return trimmed.length > 0 ? trimmed : COLLAB_FALLBACK_TITLE;
}

export function collectReferencedMd5exts(document: ProjectDocument): string[] {
  const ids = new Set<string>();
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) ids.add(costume.md5ext);
    for (const sound of target.sounds ?? []) ids.add(sound.md5ext);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function referenceHashes(
  document: ProjectDocument,
  md5ext: string,
): string[] {
  const hashes: string[] = [];
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      if (costume.md5ext === md5ext) hashes.push(costume.contentSha256);
    }
    for (const sound of target.sounds ?? []) {
      if (sound.md5ext === md5ext) hashes.push(sound.contentSha256);
    }
  }
  return hashes;
}

export function buildAssetManifest(
  document: ProjectDocument,
  assets: Map<string, Uint8Array>,
): BootstrapAsset[] {
  return collectReferencedMd5exts(document).map(md5ext => {
    const bytes = assets.get(md5ext) ?? new Uint8Array();
    return {
      md5ext,
      contentSha256: sha256Hex(bytes),
      byteLength: bytes.byteLength,
    };
  });
}

export function encodeStateVectorBase64(ydoc: Y.Doc): string {
  return base64UrlFromBytes(Y.encodeStateVector(ydoc));
}

/** True when `actual` contains every client clock from `expected`. */
export function stateVectorContains(
  actual: Uint8Array,
  expected: Uint8Array,
): boolean {
  const actualMap = Y.decodeStateVector(actual);
  const expectedMap = Y.decodeStateVector(expected);
  for (const [client, clock] of expectedMap) {
    const have = actualMap.get(client) ?? 0;
    if (have < clock) return false;
  }
  return true;
}

export function readBootstrapCheckpoint(ydoc: Y.Doc): BootstrapCheckpoint | null {
  const map = ydoc.getMap<unknown>(BOOTSTRAP_MAP);
  const bootstrapId = map.get("bootstrapId");
  const state = map.get("state");
  if (typeof bootstrapId !== "string" || bootstrapId.length === 0) return null;
  if (state !== "seeding" && state !== "sealed") return null;
  const checkpoint: BootstrapCheckpoint = {bootstrapId, state};
  const title = map.get("projectTitle");
  if (typeof title === "string") checkpoint.projectTitle = title;
  const sv = map.get("contentStateVector");
  if (typeof sv === "string") checkpoint.contentStateVector = sv;
  const hash = map.get("documentHash");
  if (typeof hash === "string") checkpoint.documentHash = hash;
  const manifestRaw = map.get("assetManifest");
  if (typeof manifestRaw === "string") {
    try {
      const parsed = JSON.parse(manifestRaw) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every(isBootstrapAsset) &&
        new Set(parsed.map(entry => entry.md5ext)).size === parsed.length
      ) {
        checkpoint.assetManifest = parsed;
      }
    } catch {
      // leave undefined; validation will reject sealed checkpoints without manifest
    }
  }
  return checkpoint;
}

function isBootstrapAsset(value: unknown): value is BootstrapAsset {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.md5ext === "string" &&
    record.md5ext.length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(record.md5ext) &&
    typeof record.contentSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(record.contentSha256) &&
    typeof record.byteLength === "number" &&
    Number.isInteger(record.byteLength) &&
    record.byteLength >= 0
  );
}

export function writeBootstrapSeeding(
  ydoc: Y.Doc,
  bootstrapId: string,
  origin: unknown,
): void {
  ydoc.transact(() => {
    const map = ydoc.getMap<unknown>(BOOTSTRAP_MAP);
    map.set("bootstrapId", bootstrapId);
    map.set("state", "seeding");
    map.delete("contentStateVector");
    map.delete("documentHash");
    map.delete("assetManifest");
  }, origin);
}

export function writeBootstrapSealed(
  ydoc: Y.Doc,
  checkpoint: Omit<BootstrapCheckpoint, "state"> & {
    contentStateVector: string;
    documentHash: string;
    assetManifest: BootstrapAsset[];
  },
  origin: unknown,
): void {
  ydoc.transact(() => {
    const map = ydoc.getMap<unknown>(BOOTSTRAP_MAP);
    map.set("bootstrapId", checkpoint.bootstrapId);
    map.set("state", "sealed");
    map.set("projectTitle", normalizeProjectTitle(checkpoint.projectTitle));
    map.set("contentStateVector", checkpoint.contentStateVector);
    map.set("documentHash", checkpoint.documentHash);
    map.set("assetManifest", JSON.stringify(checkpoint.assetManifest));
  }, origin);
}

export function newBootstrapId(randomBytes?: (n: number) => Uint8Array): string {
  const bytes = randomBytes
    ? randomBytes(16)
    : crypto.getRandomValues(new Uint8Array(16));
  return base64UrlFromBytes(bytes);
}

export function runHostPreflight(
  document: ProjectDocument,
  assets: Map<string, Uint8Array>,
  options: {
    limits?: ProjectCollabLimits;
    projectTitle?: string;
  } = {},
): HostPreflightResult {
  const limits = options.limits ?? DEFAULT_PROJECT_COLLAB_LIMITS;
  const issues: PreflightIssue[] = [];

  const schema = validateProject(document);
  if (!schema.ok) {
    for (const item of schema.issues) {
      issues.push(issue(
        String(item.code) === "MISSING_ASSET" ? "MISSING_ASSET" : "INVALID_DOCUMENT",
        item.message,
        item.path,
      ));
    }
  }
  const safeKeyIssues: ValidationIssue[] = [];
  assertSafeKeys(document, safeKeyIssues, "document");
  for (const item of safeKeyIssues) {
    issues.push(issue("SAFE_KEY_VIOLATION", item.message, item.path));
  }

  const referenced = collectReferencedMd5exts(document);
  const manifest: BootstrapAsset[] = [];
  let totalAssetBytes = 0;

  for (const md5ext of referenced) {
    const bytes = assets.get(md5ext);
    if (!bytes) {
      issues.push(issue("MISSING_ASSET", `missing asset ${md5ext}`, md5ext));
      continue;
    }
    if (bytes.byteLength > limits.maxSingleAssetBytes) {
      issues.push(issue(
        "SINGLE_ASSET_BYTES_LIMIT",
        "asset exceeds single-asset byte limit",
        md5ext,
      ));
    }
    totalAssetBytes += bytes.byteLength;
    const digest = sha256Hex(bytes);
    if (referenceHashes(document, md5ext).some(hash => hash !== digest)) {
      issues.push(issue(
        "ASSET_HASH_MISMATCH",
        "asset contentSha256 does not match bytes",
        md5ext,
      ));
    }
    manifest.push({
      md5ext,
      contentSha256: digest,
      byteLength: bytes.byteLength,
    });
  }

  if (referenced.length > limits.maxAssetCount) {
    issues.push(issue("ASSET_COUNT_LIMIT", "asset count exceeds limit"));
  }
  if (totalAssetBytes > limits.maxAssetBytes) {
    issues.push(issue("TOTAL_ASSET_BYTES_LIMIT", "total asset bytes exceed limit"));
  }

  const projectBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength;
  if (projectBytes > limits.maxProjectBytes) {
    issues.push(issue("PROJECT_BYTES_LIMIT", "project exceeds byte limit"));
  }

  if (issues.length > 0) {
    return {ok: false, issues};
  }

  return {
    ok: true,
    documentHash: contentHash(document),
    assetManifest: manifest,
    projectTitle: normalizeProjectTitle(options.projectTitle),
  };
}

export function summarizePreflightIssues(issues: PreflightIssue[]): {
  summary: string;
  codes: string[];
} {
  const assetIssues = issues.filter(item =>
    item.code === "MISSING_ASSET" ||
    item.code === "ASSET_HASH_MISMATCH" ||
    item.code === "ASSET_SIZE_MISMATCH" ||
    item.code === "SINGLE_ASSET_BYTES_LIMIT"
  );
  const codes = [...new Set(issues.map(item => item.code))];
  if (assetIssues.length > 0) {
    return {
      summary: `共同編集を開始できません。素材${assetIssues.length}件を復旧してください。`,
      codes,
    };
  }
  return {
    summary: "共同編集を開始できません。プロジェクトを確認してください。",
    codes,
  };
}

/**
 * Validate staging state against the latest sealed checkpoint.
 * Does not mutate the staging document.
 */
export function validateSealedCheckpoint(
  ydoc: Y.Doc,
  materialize: () =>
    | {ok: true; document: ProjectDocument; assets: Map<string, Uint8Array>}
    | {ok: false; issues: ValidationIssue[]},
  limits: ProjectCollabLimits = DEFAULT_PROJECT_COLLAB_LIMITS,
): CheckpointValidationResult {
  const checkpoint = readBootstrapCheckpoint(ydoc);
  if (!checkpoint || checkpoint.state !== "sealed") {
    return {
      status: "incomplete-vector",
      issues: [],
      verifiedAssetCount: 0,
      expectedAssetCount: 0,
    };
  }

  const expectedSv = bytesFromBase64Url(checkpoint.contentStateVector ?? "");
  if (!expectedSv || !checkpoint.documentHash || !checkpoint.assetManifest) {
    return {
      status: "invalid",
      issues: [issue("INVALID_DOCUMENT", "sealed checkpoint is incomplete")],
      verifiedAssetCount: 0,
      expectedAssetCount: checkpoint.assetManifest?.length ?? 0,
    };
  }

  const expectedCount = checkpoint.assetManifest.length;
  let containsExpectedVector: boolean;
  try {
    containsExpectedVector = stateVectorContains(
      Y.encodeStateVector(ydoc),
      expectedSv,
    );
  } catch {
    return {
      status: "invalid",
      issues: [issue("INVALID_DOCUMENT", "sealed checkpoint state vector is invalid")],
      verifiedAssetCount: 0,
      expectedAssetCount: expectedCount,
    };
  }
  if (!containsExpectedVector) {
    return {
      status: "incomplete-vector",
      issues: [],
      verifiedAssetCount: countVerifiedAssets(ydoc, checkpoint.assetManifest),
      expectedAssetCount: expectedCount,
    };
  }

  const materialized = materialize();
  if (!materialized.ok) {
    const hard = materialized.issues.some(item =>
      item.code === "INVALID_DOCUMENT" ||
      String(item.message).includes("limit") ||
      String(item.message).includes("forbidden")
    );
    // Missing assets after vector containment → wait / stall, not immediate invalid
    // unless structural.
    const onlyMissing = materialized.issues.every(
      item => String(item.code) === "MISSING_ASSET",
    );
    if (onlyMissing) {
      return {
        status: "missing-assets",
        issues: materialized.issues.map(item =>
          issue("MISSING_ASSET", item.message, item.path)
        ),
        verifiedAssetCount: countVerifiedAssets(ydoc, checkpoint.assetManifest),
        expectedAssetCount: expectedCount,
      };
    }
    return {
      status: hard || materialized.issues.length > 0 ? "invalid" : "awaiting-newer-seal",
      issues: materialized.issues.map(item =>
        issue(
          String(item.code) === "MISSING_ASSET" ? "MISSING_ASSET" : "INVALID_DOCUMENT",
          item.message,
          item.path,
        )
      ),
      verifiedAssetCount: countVerifiedAssets(ydoc, checkpoint.assetManifest),
      expectedAssetCount: expectedCount,
    };
  }

  const {document, assets} = materialized;
  const actualHash = contentHash(document);
  const actualManifest = buildAssetManifest(document, assets);
  const expectedManifest = [...checkpoint.assetManifest].sort((a, b) =>
    a.md5ext.localeCompare(b.md5ext)
  );
  const actualSorted = [...actualManifest].sort((a, b) =>
    a.md5ext.localeCompare(b.md5ext)
  );
  const manifestKeysMatch =
    actualSorted.length === expectedManifest.length &&
    actualSorted.every(
      (entry, index) => entry.md5ext === expectedManifest[index]?.md5ext,
    );

  if (actualHash !== checkpoint.documentHash || !manifestKeysMatch) {
    // Newer content operations may have arrived after the older seal, or the
    // document/manifest identity set does not yet agree.
    return {
      status: "awaiting-newer-seal",
      issues: [],
      verifiedAssetCount: countVerifiedAssets(ydoc, expectedManifest),
      expectedAssetCount: expectedCount,
    };
  }

  const integrityIssues: PreflightIssue[] = [];
  let verified = 0;
  for (const entry of expectedManifest) {
    const bytes = assets.get(entry.md5ext);
    if (!bytes) {
      integrityIssues.push(issue("MISSING_ASSET", `missing asset ${entry.md5ext}`, entry.md5ext));
      continue;
    }
    if (bytes.byteLength !== entry.byteLength) {
      integrityIssues.push(issue(
        "ASSET_SIZE_MISMATCH",
        "asset byte length does not match manifest",
        entry.md5ext,
      ));
      continue;
    }
    const digest = sha256Hex(bytes);
    if (digest !== entry.contentSha256) {
      integrityIssues.push(issue(
        "ASSET_HASH_MISMATCH",
        "asset digest does not match manifest",
        entry.md5ext,
      ));
      continue;
    }
    if (
      referenceHashes(document, entry.md5ext)
        .some(hash => hash !== digest)
    ) {
      integrityIssues.push(issue(
        "ASSET_HASH_MISMATCH",
        "asset digest does not match document reference",
        entry.md5ext,
      ));
      continue;
    }
    verified += 1;
  }

  if (integrityIssues.some(item =>
    item.code === "ASSET_HASH_MISMATCH" || item.code === "ASSET_SIZE_MISMATCH"
  )) {
    return {
      status: "invalid",
      issues: integrityIssues,
      verifiedAssetCount: verified,
      expectedAssetCount: expectedCount,
    };
  }
  if (integrityIssues.some(item => item.code === "MISSING_ASSET")) {
    return {
      status: "missing-assets",
      issues: integrityIssues,
      verifiedAssetCount: verified,
      expectedAssetCount: expectedCount,
    };
  }

  // Hard limits (already mostly checked by materialize).
  if (actualSorted.length > limits.maxAssetCount) {
    return {
      status: "invalid",
      issues: [issue("ASSET_COUNT_LIMIT", "asset count exceeds limit")],
      verifiedAssetCount: verified,
      expectedAssetCount: expectedCount,
    };
  }

  return {
    status: "ready",
    issues: [],
    document,
    assets,
    verifiedAssetCount: verified,
    expectedAssetCount: expectedCount,
  };
}

function countVerifiedAssets(
  ydoc: Y.Doc,
  manifest: BootstrapAsset[],
): number {
  const assets = ydoc.getMap<Uint8Array>("assets");
  let count = 0;
  for (const entry of manifest) {
    const bytes = assets.get(entry.md5ext);
    if (!(bytes instanceof Uint8Array)) continue;
    if (bytes.byteLength !== entry.byteLength) continue;
    if (sha256Hex(bytes) !== entry.contentSha256) continue;
    count += 1;
  }
  return count;
}

export function updateExceedsHardLimit(update: Uint8Array): boolean {
  return update.byteLength > MAX_DECODED_UPDATE_BYTES;
}
