/**
 * @experimental Gate 0 SB3 helpers — minimal safety checks + schema validation.
 */

import JSZip from "jszip";
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
  | "RATIO_EXCEEDED";

export interface LoadIssue {
  code: LoadIssueCode;
  message: string;
}

export interface LoadResult {
  ok: boolean;
  document?: ProjectDocument;
  warnings: string[];
  issues: LoadIssue[];
}

function pathDepth(name: string): number {
  return name.split("/").filter(Boolean).length;
}

function isUnsafePath(name: string): LoadIssue | null {
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) {
    return { code: "ABSOLUTE_PATH", message: `Absolute path: ${name}` };
  }
  // Normalize against a synthetic root; escaping root => traversal
  const normalized = posixNormalize(`root/${n}`);
  if (!normalized.startsWith("root/") && normalized !== "root") {
    return { code: "PATH_TRAVERSAL", message: `Path traversal: ${name}` };
  }
  if (n.split("/").includes("..") || n.includes("../")) {
    return { code: "PATH_TRAVERSAL", message: `Path traversal: ${name}` };
  }
  if (pathDepth(n) > DEFAULT_LIMITS.maxDepth) {
    return { code: "BAD_DEPTH", message: `Path too deep: ${name}` };
  }
  return null;
}

/** Minimal posix normalize without importing node:path (keeps logic testable). */
function posixNormalize(p: string): string {
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length === 0 || out[out.length - 1] === "..") out.push("..");
      else out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** Map Scratch project.json targets into ProjectDocument. */
export function projectJsonToDocument(raw: unknown): ProjectDocument {
  const pj = raw as {
    targets?: Array<Record<string, unknown>>;
    extensions?: string[];
    meta?: Record<string, unknown>;
  };
  const targets: ScratchTarget[] = (pj.targets ?? []).map((t, i) => {
    const blocksIn = (t.blocks ?? {}) as Record<string, Record<string, unknown>>;
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

export async function loadSb3(
  bytes: Uint8Array,
  limits: Sb3SafetyLimits = DEFAULT_LIMITS,
): Promise<LoadResult> {
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
    issues.push({
      code: "TOO_MANY_ENTRIES",
      message: `Too many zip entries: ${entries.length}`,
    });
  }

  let uncompressed = 0;
  for (const name of entries) {
    const unsafe = isUnsafePath(name);
    if (unsafe) issues.push(unsafe);
    const f = zip.files[name];
    if (f && !f.dir) {
      const data = await f.async("uint8array");
      uncompressed += data.byteLength;
    }
  }

  if (uncompressed > limits.maxUncompressedBytes) {
    issues.push({
      code: "TOO_LARGE",
      message: `Uncompressed size ${uncompressed} exceeds limit`,
    });
  }

  const ratio =
    bytes.byteLength > 0 ? uncompressed / bytes.byteLength : Infinity;
  if (ratio > limits.maxCompressionRatio) {
    issues.push({
      code: "RATIO_EXCEEDED",
      message: `Compression ratio ${ratio.toFixed(1)} exceeds limit`,
    });
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

  const document = projectJsonToDocument(raw);
  const schema = validateProject(document);
  if (!schema.ok) {
    return {
      ok: false,
      document,
      warnings,
      issues: schema.issues.map((i) => ({
        code: "SCHEMA_INVALID" as const,
        message: `${i.code}: ${i.message}`,
      })),
    };
  }

  return { ok: true, document, warnings, issues: [] };
}

export async function exportSb3(document: ProjectDocument): Promise<Uint8Array> {
  const zip = new JSZip();
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
        name: "costume1",
        dataFormat: "svg",
        assetId: "cd21514d0531fdffb22204e0ec5ed84a",
        md5ext: "cd21514d0531fdffb22204e0ec5ed84a.svg",
        rotationCenterX: 240,
        rotationCenterY: 180,
      },
    ],
    sounds: [],
    volume: 100,
    layerOrder: t.isStage ? 0 : 1,
    ...(t.isStage
      ? { tempo: 60, videoTransparency: 50, videoState: "on", textToSpeechLanguage: null }
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

  // Minimal empty SVG asset (original for this corpus; not Scratch brand assets)
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ccc"/></svg>';
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
  zip.file("cd21514d0531fdffb22204e0ec5ed84a.svg", svg);
  const out = await zip.generateAsync({ type: "uint8array" });
  return out;
}

export function semanticFingerprint(doc: ProjectDocument): string {
  const norm = {
    targets: doc.targets.map((t) => ({
      name: t.name,
      isStage: t.isStage,
      variables: t.variables ?? {},
      blocks: Object.fromEntries(
        Object.entries(t.blocks).map(([id, b]) => [
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
