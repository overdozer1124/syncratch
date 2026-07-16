/**
 * @experimental Gate 0 / R1 SB3 helpers — streaming size guards, canonical I/O, media verify.
 */

/// <reference path="./types/modules.d.ts" />

import JSZip from "jszip";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateProject,
  canonicalAssetDataFormat,
  type ProjectDocument,
  type ScratchTarget,
  type ScratchBlock,
} from "@blocksync/project-schema";
import {
  attachAssetSha256,
  CanonicalImportError,
  documentToProjectJson,
  projectJsonToDocument,
  sha256Hex,
} from "./canonical-io.js";
import { equivalenceProduction } from "./equivalence-production.js";
import { assertSafeSvgBytes, SvgSafetyError } from "./svg-sanitize.js";
import {
  MediaVerifyError,
  verifyMp3RefAgainstBytes,
  verifyWavRefAgainstBytes,
} from "./verify-media-bytes.js";
import {
  assertValidRasterBytes,
  RasterVerifyError,
} from "./verify-raster-bytes.js";

export {
  equivalenceProduction,
  EquivalenceGraphError,
  scriptFingerprint,
  scriptRootFingerprints,
  stableJson,
  topLevelPrimitiveFingerprint,
} from "./equivalence-production.js";
export {
  attachAssetSha256,
  CanonicalImportError,
  canonicalDataFormat,
  documentToProjectJson,
  projectJsonToDocument,
  sha256Hex,
  stableTargetId,
} from "./canonical-io.js";
export { assertSafeSvgBytes, SvgSafetyError } from "./svg-sanitize.js";
export {
  assertValidMp3Bytes,
  MediaVerifyError,
  parseWavBytes,
  verifyMp3RefAgainstBytes,
  verifyWavRefAgainstBytes,
} from "./verify-media-bytes.js";
export {
  assertValidRasterBytes,
  RasterVerifyError,
  parseBmpDimensions,
  parseGifDimensions,
  parseJpegDimensions,
  parsePngDimensions,
} from "./verify-raster-bytes.js";

export interface Sb3SafetyLimits {
  maxBytes: number;
  maxEntries: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
  maxDepth: number;
}

export const DEFAULT_LIMITS: Sb3SafetyLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxEntries: 200,
  maxUncompressedBytes: 20 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxDepth: 4,
};

export type LoadIssueCode =
  | "TOO_LARGE"
  | "TOO_MANY_ENTRIES"
  | "PATH_TRAVERSAL"
  | "ABSOLUTE_PATH"
  | "BAD_DEPTH"
  | "MISSING_PROJECT_JSON"
  | "INVALID_JSON"
  | "SCHEMA_INVALID"
  | "RATIO_EXCEEDED"
  | "ASSET_HASH_MISMATCH"
  | "ASSET_REF_MISMATCH"
  | "MISSING_ASSET"
  | "UNKNOWN_FIELD"
  | "SVG_UNSAFE"
  | "MEDIA_INVALID";

export interface LoadIssue {
  code: LoadIssueCode;
  message: string;
}

export interface LoadResult {
  ok: boolean;
  document?: ProjectDocument;
  projectJson?: unknown;
  warnings: string[];
  issues: LoadIssue[];
  assets?: Map<string, Uint8Array>;
}

function pathDepth(name: string): number {
  return name.split("/").filter(Boolean).length;
}

function posixNormalize(p: string): string {
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length) out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** Read ZIP-declared uncompressed size when JSZip exposes it (no inflate). */
export function declaredUncompressedSize(file: JSZip.JSZipObject): number | null {
  const data = (file as unknown as { _data?: { uncompressedSize?: number } })
    ._data;
  const n = data?.uncompressedSize;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Inflate one zip entry only after ZIP-declared size fits the remaining budget.
 */
export async function extractEntryCapped(
  file: JSZip.JSZipObject,
  maxBytes: number,
): Promise<{ ok: true; data: Uint8Array } | { ok: false; read: number }> {
  const declared = declaredUncompressedSize(file);
  if (declared !== null && declared > maxBytes) {
    return { ok: false, read: declared };
  }
  if (declared === null) {
    return { ok: false, read: 0 };
  }
  const data = new Uint8Array(await file.async("uint8array"));
  if (data.byteLength > maxBytes) {
    return { ok: false, read: data.byteLength };
  }
  return { ok: true, data };
}

export function isUnsafePath(
  name: string,
  limits: Sb3SafetyLimits = DEFAULT_LIMITS,
): LoadIssue | null {
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) {
    return { code: "ABSOLUTE_PATH", message: `Absolute path: ${name}` };
  }
  const normalized = posixNormalize(`root/${n}`);
  if (!normalized.startsWith("root/") && normalized !== "root") {
    return { code: "PATH_TRAVERSAL", message: `Path traversal: ${name}` };
  }
  if (n.split("/").includes("..") || n.includes("../")) {
    return { code: "PATH_TRAVERSAL", message: `Path traversal: ${name}` };
  }
  if (pathDepth(n) > limits.maxDepth) {
    return { code: "BAD_DEPTH", message: `Path too deep: ${name}` };
  }
  return null;
}

function md5Hex(data: Uint8Array): string {
  return createHash("md5").update(data).digest("hex");
}

/** Map jpeg zip entry names to canonical jpg md5ext keys after import normalization. */
function registerAssetMd5extAliases(assets: Map<string, Uint8Array>): void {
  for (const [md5ext, data] of assets) {
    const dot = md5ext.lastIndexOf(".");
    if (dot <= 0) continue;
    if (md5ext.slice(dot + 1).toLowerCase() !== "jpeg") continue;
    const canonical = `${md5ext.slice(0, dot)}.jpg`;
    if (!assets.has(canonical)) {
      assets.set(canonical, data);
    }
  }
}

function verifyMediaAssets(
  document: ProjectDocument,
  assets: Map<string, Uint8Array>,
  issues: LoadIssue[],
): void {
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      const file = assets.get(costume.md5ext);
      if (!file) continue;
      const fmt = costume.dataFormat;
      try {
        if (fmt === "svg") {
          assertSafeSvgBytes(file);
        } else if (["png", "jpg", "jpeg", "gif", "bmp"].includes(fmt)) {
          assertValidRasterBytes(file, fmt);
        }
      } catch (e) {
        issues.push({
          code:
            e instanceof SvgSafetyError
              ? "SVG_UNSAFE"
              : "MEDIA_INVALID",
          message:
            e instanceof SvgSafetyError
              ? `SVG ${costume.md5ext}: ${e.message}`
              : e instanceof RasterVerifyError
                ? `Costume ${costume.md5ext}: ${e.code}`
                : `Costume ${costume.md5ext}: ${String(e)}`,
        });
      }
    }
    for (const sound of target.sounds ?? []) {
      const file = assets.get(sound.md5ext);
      if (!file) continue;
      try {
        if (sound.dataFormat === "wav") {
          verifyWavRefAgainstBytes(file, sound.rate, sound.sampleCount);
        } else if (sound.dataFormat === "mp3") {
          verifyMp3RefAgainstBytes(file, sound.rate, sound.sampleCount);
        }
      } catch (e) {
        issues.push({
          code: "MEDIA_INVALID",
          message:
            e instanceof MediaVerifyError
              ? `Sound ${sound.md5ext}: ${e.code}`
              : `Sound ${sound.md5ext}: ${String(e)}`,
        });
      }
    }
  }
}

/**
 * Load SB3 with ZIP-declared size checks before inflate to bound peak memory.
 */
export async function loadSb3(
  bytes: Uint8Array,
  partialLimits: Partial<Sb3SafetyLimits> = {},
): Promise<LoadResult> {
  const limits: Sb3SafetyLimits = { ...DEFAULT_LIMITS, ...partialLimits };
  const issues: LoadIssue[] = [];
  const warnings: string[] = [];

  if (bytes.byteLength > limits.maxBytes) {
    return {
      ok: false,
      warnings,
      issues: [
        {
          code: "TOO_LARGE",
          message: `Upload exceeds ${limits.maxBytes} bytes`,
        },
      ],
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    return {
      ok: false,
      warnings,
      issues: [
        {
          code: "INVALID_JSON",
          message: `Not a zip: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }

  const entries = Object.keys(zip.files);
  if (entries.length > limits.maxEntries) {
    return {
      ok: false,
      warnings,
      issues: [
        {
          code: "TOO_MANY_ENTRIES",
          message: `Too many zip entries: ${entries.length}`,
        },
      ],
    };
  }

  let uncompressed = 0;
  const assets = new Map<string, Uint8Array>();

  for (const name of entries) {
    const unsafe = isUnsafePath(name, limits);
    if (unsafe) {
      issues.push(unsafe);
      continue;
    }
    const f = zip.files[name];
    if (!f || f.dir) continue;

    const remaining = limits.maxUncompressedBytes - uncompressed;
    if (remaining <= 0) {
      return {
        ok: false,
        warnings,
        issues: [
          {
            code: "TOO_LARGE",
            message: `Uncompressed size exceeded ${limits.maxUncompressedBytes}`,
          },
        ],
      };
    }

    const declared = declaredUncompressedSize(f);
    if (declared !== null && declared > remaining) {
      return {
        ok: false,
        warnings,
        issues: [
          {
            code: "TOO_LARGE",
            message: `Entry ${name} declared uncompressed ${declared} exceeds remaining budget ${remaining}`,
          },
        ],
      };
    }

    const extracted = await extractEntryCapped(f, remaining);
    if (!extracted.ok) {
      return {
        ok: false,
        warnings,
        issues: [
          {
            code: "TOO_LARGE",
            message:
              extracted.read > remaining
                ? `Entry ${name} declared uncompressed ${extracted.read} exceeds remaining budget ${remaining}`
                : `Entry ${name} rejected (missing size metadata or oversize after inflate)`,
          },
        ],
      };
    }
    const data = extracted.data;
    uncompressed += data.byteLength;
    const ratio =
      bytes.byteLength > 0 ? uncompressed / bytes.byteLength : Infinity;
    if (ratio > limits.maxCompressionRatio) {
      return {
        ok: false,
        warnings,
        issues: [
          {
            code: "RATIO_EXCEEDED",
            message: `Compression ratio exceeded ${limits.maxCompressionRatio} during extract`,
          },
        ],
      };
    }
    if (name !== "project.json") {
      assets.set(name, data);
    }
  }

  if (issues.length) return { ok: false, warnings, issues };

  registerAssetMd5extAliases(assets);

  const projectFile = zip.file("project.json");
  if (!projectFile) {
    return {
      ok: false,
      warnings,
      issues: [
        { code: "MISSING_PROJECT_JSON", message: "project.json missing" },
      ],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await projectFile.async("string"));
  } catch (e) {
    return {
      ok: false,
      warnings,
      issues: [
        {
          code: "INVALID_JSON",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }

  const assetShaByMd5ext = new Map<string, string>();
  for (const [md5ext, data] of assets) {
    assetShaByMd5ext.set(md5ext, sha256Hex(data));
  }

  let document: ProjectDocument;
  try {
    document = projectJsonToDocument(raw, assetShaByMd5ext);
    document = attachAssetSha256(document, assets);
  } catch (e) {
    if (e instanceof CanonicalImportError) {
      return {
        ok: false,
        warnings,
        issues: [
          {
            code: "UNKNOWN_FIELD",
            message: e.path ? `${e.path}: ${e.message}` : e.message,
          },
        ],
      };
    }
    return {
      ok: false,
      warnings,
      issues: [
        {
          code: "INVALID_JSON",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }

  const schema = validateProject(document);
  if (!schema.ok) {
    return {
      ok: false,
      document,
      projectJson: raw,
      warnings,
      issues: schema.issues.map((i) => ({
        code: "SCHEMA_INVALID" as const,
        message: `${i.code}: ${i.message}`,
      })),
    };
  }

  const pj = raw as {
    targets?: Array<{
      costumes?: Array<{ md5ext?: string; assetId?: string }>;
      sounds?: Array<{ md5ext?: string; assetId?: string }>;
    }>;
  };
  for (const t of pj.targets ?? []) {
    for (const c of [...(t.costumes ?? []), ...(t.sounds ?? [])]) {
      const md5ext = c.md5ext;
      if (!md5ext) continue;
      const dot = md5ext.lastIndexOf(".");
      const assetId = c.assetId ?? (dot > 0 ? md5ext.slice(0, dot) : md5ext);
      if (dot <= 0) {
        issues.push({
          code: "ASSET_REF_MISMATCH",
          message: `Asset ${md5ext} md5ext must include extension`,
        });
      } else {
        const stem = md5ext.slice(0, dot);
        const suffix = md5ext.slice(dot + 1);
        if (stem !== assetId) {
          issues.push({
            code: "ASSET_REF_MISMATCH",
            message: `Asset ${md5ext} stem ${stem} != assetId ${assetId}`,
          });
        }
        const dataFormat =
          "dataFormat" in c && typeof c.dataFormat === "string"
            ? c.dataFormat
            : suffix;
        if (
          canonicalAssetDataFormat(dataFormat) !==
          canonicalAssetDataFormat(suffix)
        ) {
          issues.push({
            code: "ASSET_REF_MISMATCH",
            message: `Asset ${md5ext} dataFormat ${dataFormat} != suffix ${suffix}`,
          });
        }
      }
      const file = assets.get(md5ext);
      if (!file) {
        issues.push({
          code: "MISSING_ASSET",
          message: `Missing asset file ${md5ext}`,
        });
        continue;
      }
      const digest = md5Hex(file);
      if (digest !== assetId) {
        issues.push({
          code: "ASSET_HASH_MISMATCH",
          message: `Asset ${md5ext} md5 ${digest} != assetId ${assetId}`,
        });
      }
    }
  }

  verifyMediaAssets(document, assets, issues);

  if (issues.length) {
    return { ok: false, document, projectJson: raw, warnings, issues, assets };
  }

  return { ok: true, document, projectJson: raw, warnings, issues: [], assets };
}

export async function exportSb3(
  document: ProjectDocument,
  assetBytes: Map<string, Uint8Array> = new Map(),
): Promise<Uint8Array> {
  const zip = new JSZip();

  if (document.schemaVersion >= 2) {
    const projectJson = documentToProjectJson(document);
    zip.file("project.json", JSON.stringify(projectJson));
    const needed = new Set<string>();
    for (const t of document.targets) {
      for (const c of t.costumes ?? []) needed.add(c.md5ext);
      for (const s of t.sounds ?? []) needed.add(s.md5ext);
    }
    for (const md5ext of needed) {
      const bytes = assetBytes.get(md5ext);
      if (!bytes) {
        throw new Error(`Missing asset bytes for ${md5ext}`);
      }
      zip.file(md5ext, bytes);
    }
    return zip.generateAsync({ type: "uint8array" });
  }

  // schemaVersion 1 legacy export (Gate 0 compatibility)
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ccc"/></svg>';
  const svgBytes = new TextEncoder().encode(svg);
  const assetId = md5Hex(svgBytes);
  const md5ext = `${assetId}.svg`;

  const targets = document.targets.map((t) => ({
    isStage: t.isStage,
    name: t.name,
    variables: t.variables ?? {},
    lists: t.lists ?? {},
    broadcasts: t.broadcasts ?? {},
    blocks: Object.fromEntries(
      Object.entries(t.blocks).map(([id, b]) => {
        if (Array.isArray(b)) return [id, b];
        return [
          id,
          {
            opcode: b.opcode,
            next: b.next,
            parent: b.parent,
            inputs: b.inputs,
            fields: b.fields,
            shadow: b.shadow ?? false,
            topLevel: b.topLevel ?? false,
            x: b.x ?? 0,
            y: b.y ?? 0,
          },
        ];
      }),
    ),
    currentCostume: 0,
    costumes: [
      {
        name: t.isStage ? "backdrop1" : "costume1",
        dataFormat: "svg",
        assetId,
        md5ext,
        rotationCenterX: t.isStage ? 240 : 48,
        rotationCenterY: t.isStage ? 180 : 50,
      },
    ],
    sounds: [],
    volume: 100,
    layerOrder: t.isStage ? 0 : 1,
    ...(t.isStage
      ? {
          tempo: 60,
          videoTransparency: 50,
          videoState: "on",
          textToSpeechLanguage: null,
        }
      : {
          visible: true,
          x: 0,
          y: 0,
          size: 100,
          direction: 90,
          draggable: false,
          rotationStyle: "all around",
        }),
  }));

  zip.file(
    "project.json",
    JSON.stringify({
      targets,
      monitors: [],
      extensions: document.extensions ?? [],
      meta: {
        semver: "3.0.0",
        vm: "0.2.0",
        agent: "blocksync-gate0",
        ...document.meta,
      },
    }),
  );
  zip.file(md5ext, svgBytes);
  return zip.generateAsync({ type: "uint8array" });
}

/** @deprecated Use equivalenceProduction for §6.7 UID-independent comparison. */
export function semanticFingerprint(doc: ProjectDocument): string {
  const norm = {
    extensions: [...(doc.extensions ?? [])].sort(),
    targets: doc.targets.map((t) => ({
      name: t.name,
      isStage: t.isStage,
      variables: t.variables ?? {},
      lists: t.lists ?? {},
      broadcasts: t.broadcasts ?? {},
      blocks: Object.fromEntries(
        Object.entries(t.blocks)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, b]) => {
            if (Array.isArray(b)) return [id, b];
            return [
              id,
              {
                opcode: b.opcode,
                next: b.next,
                parent: b.parent,
                inputs: b.inputs,
                fields: b.fields,
                topLevel: b.topLevel ?? false,
              },
            ];
          }),
      ),
    })),
  };
  return JSON.stringify(norm);
}

export interface LoadSb3IsolatedOptions {
  heapMb?: number;
  timeoutMs?: number;
  workerHoldMs?: number;
  manifestHoldMs?: number;
  /** Read ZIP from disk in worker instead of stdin (parent never inflates). */
  /** Pinned realpath of R1_DATA_DIR for worker path safety (§4.5). */
  dataRootReal?: string;
  holdingBudgetBytes?: number;
  spoolPath?: string;
  holdingDir?: string;
  workerTempDir?: string;
}

export interface Sb3ImportManifestAsset {
  sha256: string;
  byteLength: number;
  md5Hex: string;
  dataFormat: string;
}

export interface Sb3ImportManifest {
  assets: Sb3ImportManifestAsset[];
  holdingBytesWritten: number;
}

export interface LoadSb3IsolatedOutcome extends LoadResult {
  timedOut: boolean;
  childPid: number | null;
  childExited: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  manifest?: Sb3ImportManifest;
}

export function loadSb3Isolated(
  bytes: Uint8Array,
  partialLimits: Partial<Sb3SafetyLimits> = {},
  options: LoadSb3IsolatedOptions = {},
): Promise<LoadSb3IsolatedOutcome> {
  const heapMb = options.heapMb ?? 64;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const workerHoldMs = options.workerHoldMs ?? 0;
  const manifestHoldMs = options.manifestHoldMs ?? 0;
  const worker = join(
    dirname(fileURLToPath(import.meta.url)),
    "load-sb3-worker.mjs",
  );

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (result: LoadSb3IsolatedOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();
        child.stdin.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${heapMb}`, "--import", "tsx", worker],
      {
        env: {
          ...process.env,
          GATE0_SB3_LIMITS: JSON.stringify({
            ...DEFAULT_LIMITS,
            ...partialLimits,
          }),
          ...(workerHoldMs > 0
            ? { GATE0_SB3_WORKER_HOLD_MS: String(workerHoldMs) }
            : {}),
          ...(manifestHoldMs > 0
            ? { GATE0_SB3_MANIFEST_HOLD_MS: String(manifestHoldMs) }
            : {}),
          ...(options.dataRootReal
            ? { GATE0_SB3_DATA_ROOT_REAL: options.dataRootReal }
            : {}),
          ...(options.holdingBudgetBytes !== undefined
            ? {
                GATE0_SB3_HOLDING_BUDGET_BYTES: String(
                  options.holdingBudgetBytes,
                ),
              }
            : {}),
          ...(options.spoolPath
            ? { GATE0_SB3_SPOOL_PATH: options.spoolPath }
            : {}),
          ...(options.holdingDir
            ? { GATE0_SB3_HOLDING_DIR: options.holdingDir }
            : {}),
          ...(options.workerTempDir
            ? { GATE0_SB3_WORKER_TEMP_DIR: options.workerTempDir }
            : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const childPid = child.pid ?? null;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => {
      finish({
        ok: false,
        warnings: [],
        issues: [
          {
            code: "TOO_LARGE",
            message: `isolate spawn failed: ${e.message}`,
          },
        ],
        timedOut: false,
        childPid,
        childExited: true,
        exitCode: null,
        signal: null,
      });
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          warnings: [],
          issues: [
            {
              code: "TOO_LARGE",
              message: `isolate timed out after ${timeoutMs}ms`,
            },
          ],
          timedOut: true,
          childPid,
          childExited: true,
          exitCode: code,
          signal,
        });
        return;
      }
      const text = Buffer.concat(out).toString("utf8");
      try {
        const parsed = JSON.parse(text) as LoadResult & {
          manifest?: Sb3ImportManifest;
        };
        finish({
          ...parsed,
          timedOut: false,
          childPid,
          childExited: true,
          exitCode: code,
          signal,
        });
      } catch {
        finish({
          ok: false,
          warnings: [],
          issues: [
            {
              code: "TOO_LARGE",
              message: `isolate exited code=${code} signal=${signal}: ${Buffer.concat(err).toString("utf8") || text}`,
            },
          ],
          timedOut: false,
          childPid,
          childExited: true,
          exitCode: code,
          signal,
        });
      }
    });
    if (options.spoolPath) {
      child.stdin.end();
    } else {
      child.stdin.write(Buffer.from(bytes));
      child.stdin.end();
    }
  });
}
