import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import type {
  BlockMapEntry,
  CostumeRef,
  ProjectDocument,
  ScratchBlock,
  ScratchTarget,
  SoundRef,
} from "@blocksync/project-schema";
import {
  isPrimitiveBlockEntry,
} from "@blocksync/project-schema";

const utf8 = new TextEncoder();

export class CanonicalImportError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "CanonicalImportError";
  }
}

const TOP_LEVEL_ALLOWED = new Set([
  "targets",
  "extensions",
  "meta",
  "monitors",
]);

const TARGET_COMMON_ALLOWED = new Set([
  "isStage",
  "name",
  "variables",
  "lists",
  "broadcasts",
  "blocks",
  "comments",
  "currentCostume",
  "costumes",
  "sounds",
  "volume",
  "layerOrder",
]);

const TARGET_STAGE_ALLOWED = new Set([
  ...TARGET_COMMON_ALLOWED,
  "tempo",
  "videoTransparency",
  "videoState",
  "textToSpeechLanguage",
]);

const TARGET_SPRITE_ALLOWED = new Set([
  ...TARGET_COMMON_ALLOWED,
  "visible",
  "x",
  "y",
  "size",
  "direction",
  "draggable",
  "rotationStyle",
]);

const BLOCK_ALLOWED = new Set([
  "opcode",
  "next",
  "parent",
  "inputs",
  "fields",
  "shadow",
  "topLevel",
  "x",
  "y",
  "mutation",
]);

const COSTUME_FORMATS = new Set(["svg", "png", "jpg", "jpeg", "bmp", "gif"]);
const SOUND_FORMATS = new Set(["wav", "mp3"]);

export function canonicalDataFormat(format: string): string {
  const lower = format.toLowerCase();
  return lower === "jpeg" ? "jpg" : lower;
}

function canonicalMd5ext(
  md5ext: string,
  dataFormat: string,
  path: string,
): string {
  const dot = md5ext.lastIndexOf(".");
  if (dot <= 0) return md5ext;
  const stem = md5ext.slice(0, dot);
  const suffix = md5ext.slice(dot + 1);
  const suffixLower = suffix.toLowerCase();
  if (suffixLower === "jpeg") {
    return `${stem}.jpg`;
  }
  if (canonicalDataFormat(dataFormat) !== suffixLower) {
    throw new CanonicalImportError(
      "md5ext suffix must match canonical dataFormat",
      path,
    );
  }
  return md5ext;
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function stableTargetId(name: string, isStage: boolean): string {
  return sha256Hex(utf8.encode(`${isStage}:${name}`)).slice(0, 16);
}

function assertPlainObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalImportError(`${path} must be an object`, path);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new CanonicalImportError(`unknown field ${key}`, `${path}.${key}`);
    }
  }
}

function parseCostumeRef(
  raw: unknown,
  index: number,
  path: string,
  contentSha256: string,
): CostumeRef {
  const c = assertPlainObject(raw, `${path}[${index}]`);
  const dataFormat = canonicalDataFormat(String(c.dataFormat ?? ""));
  if (!COSTUME_FORMATS.has(String(c.dataFormat ?? "").toLowerCase())) {
    throw new CanonicalImportError(
      `disallowed costume dataFormat ${String(c.dataFormat)}`,
      `${path}[${index}].dataFormat`,
    );
  }
  const assetId = String(c.assetId ?? "");
  const rawMd5ext = String(c.md5ext ?? "");
  if (!assetId || !rawMd5ext) {
    throw new CanonicalImportError(
      "costume assetId and md5ext are required",
      `${path}[${index}]`,
    );
  }
  const md5ext = canonicalMd5ext(
    rawMd5ext,
    dataFormat,
    `${path}[${index}].md5ext`,
  );
  return {
    kind: "costume",
    name: String(c.name ?? ""),
    assetId,
    md5ext,
    dataFormat,
    contentSha256,
    rotationCenterX: Number(c.rotationCenterX ?? 0),
    rotationCenterY: Number(c.rotationCenterY ?? 0),
    bitmapResolution:
      typeof c.bitmapResolution === "number" ? c.bitmapResolution : undefined,
  };
}

function parseSoundRef(
  raw: unknown,
  index: number,
  path: string,
  contentSha256: string,
): SoundRef {
  const s = assertPlainObject(raw, `${path}[${index}]`);
  const dataFormat = canonicalDataFormat(String(s.dataFormat ?? ""));
  if (!SOUND_FORMATS.has(String(s.dataFormat ?? "").toLowerCase())) {
    throw new CanonicalImportError(
      `disallowed sound dataFormat ${String(s.dataFormat)}`,
      `${path}[${index}].dataFormat`,
    );
  }
  const assetId = String(s.assetId ?? "");
  const rawMd5ext = String(s.md5ext ?? "");
  if (!assetId || !rawMd5ext) {
    throw new CanonicalImportError(
      "sound assetId and md5ext are required",
      `${path}[${index}]`,
    );
  }
  const md5ext = canonicalMd5ext(
    rawMd5ext,
    dataFormat,
    `${path}[${index}].md5ext`,
  );
  return {
    kind: "sound",
    name: String(s.name ?? ""),
    assetId,
    md5ext,
    dataFormat,
    contentSha256,
    rate: Number(s.rate ?? 0),
    sampleCount: Number(s.sampleCount ?? 0),
    format: String(s.format ?? ""),
  };
}

function parseBlockEntry(
  id: string,
  raw: unknown,
  path: string,
): BlockMapEntry {
  if (Array.isArray(raw)) {
    if (!isPrimitiveBlockEntry(raw)) {
      throw new CanonicalImportError(
        `invalid primitive block entry at ${id}`,
        path,
      );
    }
    return raw;
  }
  const b = assertPlainObject(raw, path);
  rejectUnknownKeys(b, BLOCK_ALLOWED, path);
  if ("comment" in b) {
    throw new CanonicalImportError("block comment field is disallowed", path);
  }
  return {
    id,
    opcode: String(b.opcode ?? ""),
    next: (b.next as string | null) ?? null,
    parent: (b.parent as string | null) ?? null,
    inputs: (b.inputs as Record<string, unknown>) ?? {},
    fields: (b.fields as Record<string, unknown>) ?? {},
    shadow: Boolean(b.shadow),
    topLevel: Boolean(b.topLevel),
    x: typeof b.x === "number" ? Math.round(b.x) : undefined,
    y: typeof b.y === "number" ? Math.round(b.y) : undefined,
    mutation:
      b.mutation && typeof b.mutation === "object"
        ? (b.mutation as Record<string, unknown>)
        : undefined,
  };
}

function parseTarget(
  raw: unknown,
  index: number,
  assetShaByMd5ext: Map<string, string>,
): ScratchTarget {
  const path = `targets[${index}]`;
  const t = assertPlainObject(raw, path);
  const isStage = Boolean(t.isStage);
  const allowed = isStage ? TARGET_STAGE_ALLOWED : TARGET_SPRITE_ALLOWED;
  rejectUnknownKeys(t, allowed, path);

  const comments = t.comments;
  if (comments !== undefined) {
    if (
      typeof comments !== "object" ||
      comments === null ||
      Array.isArray(comments)
    ) {
      throw new CanonicalImportError("comments must be an object", `${path}.comments`);
    }
    if (Object.keys(comments).length > 0) {
      throw new CanonicalImportError(
        "non-empty comments are disallowed",
        `${path}.comments`,
      );
    }
  }

  const name = String(t.name ?? "");
  const targetPath = `${path}`;
  const blocksIn =
    t.blocks && typeof t.blocks === "object" && !Array.isArray(t.blocks)
      ? (t.blocks as Record<string, unknown>)
      : {};
  const blocks: Record<string, BlockMapEntry> = {};
  for (const [id, bRaw] of Object.entries(blocksIn)) {
    blocks[id] = parseBlockEntry(id, bRaw, `${targetPath}.blocks.${id}`);
  }

  const costumes: CostumeRef[] = [];
  if (Array.isArray(t.costumes)) {
    for (let i = 0; i < t.costumes.length; i++) {
      const cRaw = t.costumes[i];
      const cObj = assertPlainObject(cRaw, `${targetPath}.costumes[${i}]`);
      const md5ext = String(cObj.md5ext ?? "");
      costumes.push(
        parseCostumeRef(
          cRaw,
          i,
          `${targetPath}.costumes`,
          assetShaByMd5ext.get(md5ext) ?? "",
        ),
      );
    }
  }

  const sounds: SoundRef[] = [];
  if (Array.isArray(t.sounds)) {
    for (let i = 0; i < t.sounds.length; i++) {
      const sRaw = t.sounds[i];
      const sObj = assertPlainObject(sRaw, `${targetPath}.sounds[${i}]`);
      const md5ext = String(sObj.md5ext ?? "");
      sounds.push(
        parseSoundRef(
          sRaw,
          i,
          `${targetPath}.sounds`,
          assetShaByMd5ext.get(md5ext) ?? "",
        ),
      );
    }
  }

  const base: ScratchTarget = {
    id: stableTargetId(name, isStage),
    name,
    isStage,
    blocks,
    variables: (t.variables as ScratchTarget["variables"]) ?? {},
    lists: (t.lists as ScratchTarget["lists"]) ?? {},
    broadcasts: (t.broadcasts as ScratchTarget["broadcasts"]) ?? {},
    comments: {},
    currentCostume: Number(t.currentCostume ?? 0),
    costumes,
    sounds,
    volume: Number(t.volume ?? 100),
    layerOrder: Number(t.layerOrder ?? 0),
  };

  if (isStage) {
    return {
      ...base,
      tempo: Number(t.tempo ?? 60),
      videoTransparency: Number(t.videoTransparency ?? 50),
      videoState: String(t.videoState ?? "on"),
      textToSpeechLanguage:
        t.textToSpeechLanguage === undefined
          ? null
          : (t.textToSpeechLanguage as string | null),
    };
  }

  return {
    ...base,
    visible: Boolean(t.visible ?? true),
    x: Number(t.x ?? 0),
    y: Number(t.y ?? 0),
    size: Number(t.size ?? 100),
    direction: Number(t.direction ?? 90),
    draggable: Boolean(t.draggable ?? false),
    rotationStyle: String(t.rotationStyle ?? "all around"),
  };
}

/** Convert SB3 project.json to schemaVersion 2 ProjectDocument (Design §6.4–§6.5). */
export function projectJsonToDocument(
  raw: unknown,
  assetShaByMd5ext: Map<string, string> = new Map(),
): ProjectDocument {
  const root = assertPlainObject(raw, "project.json");
  rejectUnknownKeys(root, TOP_LEVEL_ALLOWED, "project.json");

  if (root.monitors !== undefined) {
    if (!Array.isArray(root.monitors)) {
      throw new CanonicalImportError("monitors must be an array", "monitors");
    }
    if (root.monitors.length > 0) {
      throw new CanonicalImportError(
        "non-empty monitors are disallowed",
        "monitors",
      );
    }
  }

  if (!Array.isArray(root.targets)) {
    throw new CanonicalImportError("targets must be an array", "targets");
  }

  const targets = root.targets.map((t, i) =>
    parseTarget(t, i, assetShaByMd5ext),
  );

  return {
    schemaVersion: 2,
    targets,
    extensions: Array.isArray(root.extensions)
      ? [...(root.extensions as string[])]
      : [],
    monitors: [],
    meta: {
      semver: "3.0.0",
      vm: "14.1.0",
      agent: "blocksync-sb3-tools",
      ...(root.meta && typeof root.meta === "object"
        ? (root.meta as Record<string, unknown>)
        : {}),
    },
  };
}

function blockToSb3(b: ScratchBlock): Record<string, unknown> {
  const out: Record<string, unknown> = {
    opcode: b.opcode,
    next: b.next,
    parent: b.parent,
    inputs: b.inputs,
    fields: b.fields,
    shadow: b.shadow ?? false,
    topLevel: b.topLevel ?? false,
  };
  if (b.topLevel) {
    out.x = Math.round(b.x ?? 0);
    out.y = Math.round(b.y ?? 0);
  }
  if (b.mutation !== undefined) {
    out.mutation = b.mutation;
  }
  return out;
}

function costumeToSb3(c: CostumeRef): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: c.name,
    dataFormat: c.dataFormat === "jpg" ? "jpg" : c.dataFormat,
    assetId: c.assetId,
    md5ext: c.md5ext,
    rotationCenterX: c.rotationCenterX,
    rotationCenterY: c.rotationCenterY,
  };
  if (c.bitmapResolution !== undefined) {
    out.bitmapResolution = c.bitmapResolution;
  }
  return out;
}

function soundToSb3(s: SoundRef): Record<string, unknown> {
  return {
    name: s.name,
    assetId: s.assetId,
    dataFormat: s.dataFormat,
    format: s.format,
    rate: s.rate,
    sampleCount: s.sampleCount,
    md5ext: s.md5ext,
  };
}

function blockEntryToSb3(entry: BlockMapEntry): Record<string, unknown> | unknown[] {
  if (Array.isArray(entry)) return entry;
  return blockToSb3(entry);
}

function targetToSb3(t: ScratchTarget): Record<string, unknown> {
  const blocks: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(t.blocks)) {
    blocks[id] = blockEntryToSb3(entry);
  }

  const base: Record<string, unknown> = {
    isStage: t.isStage,
    name: t.name,
    variables: t.variables ?? {},
    lists: t.lists ?? {},
    broadcasts: t.broadcasts ?? {},
    blocks,
    comments: {},
    currentCostume: t.currentCostume ?? 0,
    costumes: (t.costumes ?? []).map(costumeToSb3),
    sounds: (t.sounds ?? []).map(soundToSb3),
    volume: t.volume ?? 100,
    layerOrder: t.layerOrder ?? 0,
  };

  if (t.isStage) {
    return {
      ...base,
      tempo: t.tempo ?? 60,
      videoTransparency: t.videoTransparency ?? 50,
      videoState: t.videoState ?? "on",
      textToSpeechLanguage: t.textToSpeechLanguage ?? null,
    };
  }

  return {
    ...base,
    visible: t.visible ?? true,
    x: t.x ?? 0,
    y: t.y ?? 0,
    size: t.size ?? 100,
    direction: t.direction ?? 90,
    draggable: t.draggable ?? false,
    rotationStyle: t.rotationStyle ?? "all around",
  };
}

/** Export normalized SB3 project.json object (Design §6.4). */
export function documentToProjectJson(
  document: ProjectDocument,
): Record<string, unknown> {
  return {
    targets: document.targets.map(targetToSb3),
    monitors: [],
    extensions: [...(document.extensions ?? [])],
    meta: {
      semver: "3.0.0",
      vm: "14.1.0",
      agent: "blocksync-sb3-tools",
      ...document.meta,
    },
  };
}

/** Fill contentSha256 on asset refs from zip bytes. */
export function attachAssetSha256(
  document: ProjectDocument,
  assets: Map<string, Uint8Array>,
): ProjectDocument {
  const shaByMd5ext = new Map<string, string>();
  for (const [md5ext, bytes] of assets) {
    shaByMd5ext.set(md5ext, sha256Hex(bytes));
  }
  return {
    ...document,
    targets: document.targets.map((t) => ({
      ...t,
      costumes: (t.costumes ?? []).map((c) => ({
        ...c,
        contentSha256: shaByMd5ext.get(c.md5ext) ?? c.contentSha256,
      })),
      sounds: (t.sounds ?? []).map((s) => ({
        ...s,
        contentSha256: shaByMd5ext.get(s.md5ext) ?? s.contentSha256,
      })),
    })),
  };
}
