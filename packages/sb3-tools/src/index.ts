/**
 * @experimental Gate 0 SB3 helpers — streaming size guards + schema validation.
 */

import JSZip from "jszip";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateProject,
  type ProjectDocument,
  type ScratchTarget,
  type ScratchBlock,
} from "@blocksync/project-schema";

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
  | "ASSET_HASH_MISMATCH";

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
 * Oversized declarations are rejected without calling into inflate (peak memory
 * stayed at the compressed zip buffer). Unknown/missing declarations refuse extract.
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
    // Do not inflate blindly when the archive omits size metadata.
    return { ok: false, read: 0 };
  }
  // Declared size is within budget — inflate. Re-check actual length afterwards.
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

export function projectJsonToDocument(raw: unknown): ProjectDocument {
  if (!raw || typeof raw !== "object") {
    throw new Error("project.json root must be an object");
  }
  const pj = raw as {
    targets?: unknown;
    extensions?: string[];
    meta?: Record<string, unknown>;
  };
  if (!Array.isArray(pj.targets)) {
    throw new Error("project.json targets must be an array");
  }
  const targets: ScratchTarget[] = pj.targets.map((tRaw, i) => {
    if (!tRaw || typeof tRaw !== "object") {
      throw new Error(`targets[${i}] must be an object`);
    }
    const t = tRaw as Record<string, unknown>;
    const blocksIn =
      t.blocks && typeof t.blocks === "object"
        ? (t.blocks as Record<string, Record<string, unknown>>)
        : {};
    const blocks: Record<string, ScratchBlock> = {};
    for (const [id, b] of Object.entries(blocksIn)) {
      blocks[id] = {
        id,
        opcode: String(b.opcode ?? ""),
        next: (b.next as string | null) ?? null,
        parent: (b.parent as string | null) ?? null,
        inputs: (b.inputs as Record<string, unknown>) ?? {},
        fields: (b.fields as Record<string, unknown>) ?? {},
        shadow: Boolean(b.shadow),
        topLevel: Boolean(b.topLevel),
        x: typeof b.x === "number" ? b.x : undefined,
        y: typeof b.y === "number" ? b.y : undefined,
      };
    }
    return {
      id: String(t.id ?? (t.isStage ? "stage" : `target-${i}`)),
      name: String(t.name ?? `Target${i}`),
      isStage: Boolean(t.isStage),
      blocks,
      variables: (t.variables as ScratchTarget["variables"]) ?? {},
      lists: (t.lists as ScratchTarget["lists"]) ?? {},
      broadcasts: (t.broadcasts as ScratchTarget["broadcasts"]) ?? {},
    };
  });
  return {
    schemaVersion: 1,
    targets,
    extensions: pj.extensions ?? [],
    meta: pj.meta,
  };
}

function md5Hex(data: Uint8Array): string {
  return createHash("md5").update(data).digest("hex");
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

    // Reject using ZIP-declared size before inflate (blocks STORE/huge entries).
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

  let document: ProjectDocument;
  try {
    document = projectJsonToDocument(raw);
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

  // Costume/sound md5ext vs file content hash (basename without extension)
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
      const file = assets.get(md5ext);
      if (!file) {
        warnings.push(`Missing asset file ${md5ext}`);
        continue;
      }
      const digest = md5Hex(file);
      const assetId = c.assetId ?? md5ext.replace(/\.[^.]+$/, "");
      if (digest !== assetId) {
        issues.push({
          code: "ASSET_HASH_MISMATCH",
          message: `Asset ${md5ext} md5 ${digest} != assetId ${assetId}`,
        });
      }
    }
  }
  if (issues.length) {
    return { ok: false, document, projectJson: raw, warnings, issues, assets };
  }

  return { ok: true, document, projectJson: raw, warnings, issues: [], assets };
}

export async function exportSb3(document: ProjectDocument): Promise<Uint8Array> {
  const zip = new JSZip();
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
      Object.entries(t.blocks).map(([id, b]) => [
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
      ]),
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
  zip.file(md5ext, svg);
  return zip.generateAsync({ type: "uint8array" });
}

/** Semantic fingerprint including lists, broadcasts, extensions, costume refs. */
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
          .map(([id, b]) => [
            id,
            {
              opcode: b.opcode,
              next: b.next,
              parent: b.parent,
              inputs: b.inputs,
              fields: b.fields,
              topLevel: b.topLevel ?? false,
            },
          ]),
      ),
    })),
  };
  return JSON.stringify(norm);
}

export interface LoadSb3IsolatedOptions {
  heapMb?: number;
  timeoutMs?: number;
  /**
   * Test-only: asks the worker to sleep this many ms before loadSb3.
   * Honoured only when NODE_ENV=test or GATE0_TEST_HOOKS=1 (also enforced in worker).
   */
  workerHoldMs?: number;
}

export interface LoadSb3IsolatedOutcome extends LoadResult {
  timedOut: boolean;
  childPid: number | null;
  childExited: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
}

/**
 * Run loadSb3 in a child process. `--max-old-space-size` limits the V8 old-space
 * heap suggestion for the child (not a process-wide RSS/Buffer hard cap).
 * Wall-clock timeout kills the child; the promise resolves only after the child
 * has exited (no lingering process for the normal path).
 */
export function loadSb3Isolated(
  bytes: Uint8Array,
  partialLimits: Partial<Sb3SafetyLimits> = {},
  options: LoadSb3IsolatedOptions = {},
): Promise<LoadSb3IsolatedOutcome> {
  const heapMb = options.heapMb ?? 64;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const workerHoldMs = options.workerHoldMs ?? 0;
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
        const parsed = JSON.parse(text) as LoadResult;
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
    child.stdin.write(Buffer.from(bytes));
    child.stdin.end();
  });
}
