/**
 * @experimental R1 blocksync.project/v1 envelope helpers.
 */

import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {
  emptyProject,
  isScratchBlock,
  type BlockMapEntry,
  type CostumeRef,
  type ProjectDocument,
  type ScratchBlock,
  type ScratchTarget,
  type SoundRef,
} from "@blocksync/project-schema";

export const PROJECT_FORMAT = "blocksync.project/v1" as const;

export type RevisionMeta =
  | { op: "save_document" }
  | { op: "restore"; snapshotId: string };

export interface ProjectEnvelopeV1 {
  format: typeof PROJECT_FORMAT;
  projectId: string;
  organizationId: string;
  title: string;
  revision: number;
  schemaVersion: number;
  contentHash: string;
  updatedAt: string;
  updatedByUserId: string;
  document: ProjectDocument;
  /** Set on revisions created after bootstrap (create revision 0 omits this). */
  revisionMeta?: RevisionMeta;
}

export type RequestOp = "save_document" | "restore";

const utf8 = new TextEncoder();

function sha256Utf8(value: string): string {
  return bytesToHex(sha256(utf8.encode(value)));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeysDeep(obj[key]);
    }
    return out;
  }
  return value;
}

function canonicalizeBlockV1(block: ScratchBlock): Record<string, unknown> {
  return sortKeysDeep({
    id: block.id,
    opcode: block.opcode,
    next: block.next,
    parent: block.parent,
    inputs: block.inputs ?? {},
    fields: block.fields ?? {},
    shadow: block.shadow ?? false,
    topLevel: block.topLevel ?? false,
    x: block.x ?? null,
    y: block.y ?? null,
  }) as Record<string, unknown>;
}

function canonicalizeBlockV2(block: ScratchBlock): Record<string, unknown> {
  const base = canonicalizeBlockV1(block);
  if (block.mutation === undefined) {
    return base;
  }
  return sortKeysDeep({
    ...base,
    mutation: block.mutation,
  }) as Record<string, unknown>;
}

function canonicalizeCostumeRef(ref: CostumeRef): Record<string, unknown> {
  return sortKeysDeep(ref) as Record<string, unknown>;
}

function canonicalizeSoundRef(ref: SoundRef): Record<string, unknown> {
  return sortKeysDeep(ref) as Record<string, unknown>;
}

function canonicalizeTargetV1(target: ScratchTarget): Record<string, unknown> {
  const blockIds = Object.keys(target.blocks).sort();
  const blocks: Record<string, unknown> = {};
  for (const id of blockIds) {
    const entry = target.blocks[id]!;
    if (isScratchBlock(entry)) {
      blocks[id] = canonicalizeBlockV1(entry);
    }
  }
  return {
    id: target.id,
    name: target.name,
    isStage: target.isStage,
    blocks,
    variables: sortKeysDeep(target.variables ?? {}),
    lists: sortKeysDeep(target.lists ?? {}),
    broadcasts: sortKeysDeep(target.broadcasts ?? {}),
  };
}

function canonicalizeBlockEntryV2(entry: BlockMapEntry): unknown {
  if (Array.isArray(entry)) {
    return sortKeysDeep(entry);
  }
  return canonicalizeBlockV2(entry);
}

function canonicalizeTargetV2(target: ScratchTarget): Record<string, unknown> {
  const blockIds = Object.keys(target.blocks).sort();
  const blocks: Record<string, unknown> = {};
  for (const id of blockIds) {
    blocks[id] = canonicalizeBlockEntryV2(target.blocks[id]!);
  }

  const costumes = (target.costumes ?? []).map(canonicalizeCostumeRef);
  const sounds = (target.sounds ?? []).map(canonicalizeSoundRef);

  const common: Record<string, unknown> = {
    id: target.id,
    name: target.name,
    isStage: target.isStage,
    blocks,
    variables: sortKeysDeep(target.variables ?? {}),
    lists: sortKeysDeep(target.lists ?? {}),
    broadcasts: sortKeysDeep(target.broadcasts ?? {}),
    comments: sortKeysDeep(target.comments ?? {}),
    currentCostume: target.currentCostume ?? 0,
    costumes,
    sounds,
    volume: target.volume ?? 100,
    layerOrder: target.layerOrder ?? 0,
  };

  if (target.isStage) {
    return {
      ...common,
      tempo: target.tempo ?? 60,
      videoTransparency: target.videoTransparency ?? 50,
      videoState: target.videoState ?? "on",
      textToSpeechLanguage: target.textToSpeechLanguage ?? null,
    };
  }

  return {
    ...common,
    visible: target.visible ?? true,
    x: target.x ?? 0,
    y: target.y ?? 0,
    size: target.size ?? 100,
    direction: target.direction ?? 90,
    draggable: target.draggable ?? false,
    rotationStyle: target.rotationStyle ?? "all around",
  };
}

/** Deterministic UTF-8 JSON covering the entire ProjectDocument. */
export function canonicalizeDocument(doc: ProjectDocument): string {
  const canonicalizeTarget =
    doc.schemaVersion >= 2 ? canonicalizeTargetV2 : canonicalizeTargetV1;
  const targets = [...doc.targets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(canonicalizeTarget);
  const extensions = [...(doc.extensions ?? [])].sort();
  const meta = sortKeysDeep(doc.meta ?? {}) as Record<string, unknown>;

  if (doc.schemaVersion >= 2) {
    return JSON.stringify({
      schemaVersion: doc.schemaVersion,
      extensions,
      meta,
      monitors: doc.monitors ?? [],
      targets,
    });
  }

  return JSON.stringify({
    schemaVersion: doc.schemaVersion,
    extensions,
    meta,
    targets,
  });
}

export function contentHash(doc: ProjectDocument): string {
  return sha256Utf8(canonicalizeDocument(doc));
}

export function requestHash(args: {
  op: RequestOp;
  schemaVersion: number;
  contentHash: string;
  snapshotId?: string;
}): string {
  const material: Record<string, string | number> = {
    contentHash: args.contentHash,
    op: args.op,
    schemaVersion: args.schemaVersion,
  };
  if (args.op === "restore") {
    if (!args.snapshotId) {
      throw new Error("requestHash restore requires snapshotId");
    }
    material.snapshotId = args.snapshotId;
  }
  return sha256Utf8(JSON.stringify(material));
}

export function emptyDocument(): ProjectDocument {
  return emptyProject();
}

export function richFixtureDocument(): ProjectDocument {
  return {
    schemaVersion: 1,
    extensions: ["music"],
    meta: { locale: "ja", title: "サンプル" },
    targets: [
      {
        id: "stage",
        name: "ステージ",
        isStage: true,
        blocks: {},
        variables: { gv1: ["全体スコア", 0] },
        lists: { gl1: ["一覧", ["いち", "に"]] },
        broadcasts: { gb1: "開始メッセージ" },
      },
      {
        id: "sprite-neko",
        name: "ネコ",
        isStage: false,
        variables: { v1: ["歩く歩数", 10] },
        lists: { l1: ["買い物", ["りんご", "みかん"]] },
        broadcasts: { b1: "ジャンプした" },
        blocks: {
          hat: {
            id: "hat",
            opcode: "event_whenflagclicked",
            next: "say",
            parent: null,
            inputs: {},
            fields: {},
            topLevel: true,
          },
          say: {
            id: "say",
            opcode: "looks_say",
            next: "music",
            parent: "hat",
            inputs: { MESSAGE: [1, [10, "こんにちは"]] },
            fields: {},
            topLevel: false,
          },
          music: {
            id: "music",
            opcode: "music_playDrumForBeats",
            next: null,
            parent: "say",
            inputs: {},
            fields: {},
            topLevel: false,
          },
        },
      },
    ],
  };
}

/** §6.5.3 custom procedure fixture (schemaVersion 2). */
export function customProcedureFixtureDocument(): ProjectDocument {
  return {
    schemaVersion: 2,
    extensions: [],
    monitors: [],
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "backdrop1",
            assetId: "4f38e8130ecd3815fae7c1250bcae067",
            md5ext: "4f38e8130ecd3815fae7c1250bcae067.svg",
            dataFormat: "svg",
            contentSha256:
              "0ca3ec604daf58513d2c372eeda9a72b5cc12b2fbd4e7ea9218711b6c0cbd878",
            rotationCenterX: 240,
            rotationCenterY: 180,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null,
      },
      {
        id: "sprite1",
        name: "Sprite1",
        isStage: false,
        blocks: {
          define_id: {
            id: "define_id",
            opcode: "procedures_definition",
            next: "attached_id",
            parent: null,
            inputs: { custom_block: [2, "proto_id"] },
            fields: {},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 0,
          },
          proto_id: {
            id: "proto_id",
            opcode: "procedures_prototype",
            next: null,
            parent: "define_id",
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false,
            mutation: {
              tagName: "mutation",
              children: [],
              proccode: "my block %s",
              argumentids: '["arg_id"]',
              argumentnames: '["x"]',
              argumentdefaults: '[""]',
              warp: "false",
            },
          },
          attached_id: {
            id: "attached_id",
            opcode: "motion_movesteps",
            next: null,
            parent: "define_id",
            inputs: { STEPS: [1, [4, "10"]] },
            fields: {},
            topLevel: false,
          },
        },
        variables: {},
        lists: {},
        broadcasts: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "costume1",
            assetId: "cd21514d053fa7b8d9cb0a8f9c1543c4",
            md5ext: "cd21514d053fa7b8d9cb0a8f9c1543c4.svg",
            dataFormat: "svg",
            contentSha256:
              "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
            rotationCenterX: 48,
            rotationCenterY: 50,
          },
        ],
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
      },
    ],
  };
}

export function assertEnvelope(value: unknown): ProjectEnvelopeV1 {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid envelope: not an object");
  }
  const v = value as Record<string, unknown>;
  if (v.format !== PROJECT_FORMAT) {
    throw new Error(`Invalid envelope: unexpected format ${String(v.format)}`);
  }
  if (typeof v.projectId !== "string" || !v.projectId) {
    throw new Error("Invalid envelope: projectId");
  }
  if (typeof v.organizationId !== "string") {
    throw new Error("Invalid envelope: organizationId");
  }
  if (typeof v.title !== "string") {
    throw new Error("Invalid envelope: title");
  }
  if (typeof v.revision !== "number") {
    throw new Error("Invalid envelope: revision");
  }
  if (typeof v.schemaVersion !== "number") {
    throw new Error("Invalid envelope: schemaVersion");
  }
  if (typeof v.contentHash !== "string") {
    throw new Error("Invalid envelope: contentHash");
  }
  if (typeof v.updatedAt !== "string") {
    throw new Error("Invalid envelope: updatedAt");
  }
  if (typeof v.updatedByUserId !== "string") {
    throw new Error("Invalid envelope: updatedByUserId");
  }
  if (!v.document || typeof v.document !== "object") {
    throw new Error("Invalid envelope: document");
  }
  const document = v.document as ProjectDocument;
  if (v.schemaVersion !== document.schemaVersion) {
    throw new Error("SCHEMA_VERSION_MISMATCH");
  }
  const envelope: ProjectEnvelopeV1 = {
    format: PROJECT_FORMAT,
    projectId: v.projectId,
    organizationId: v.organizationId,
    title: v.title,
    revision: v.revision,
    schemaVersion: v.schemaVersion,
    contentHash: v.contentHash,
    updatedAt: v.updatedAt,
    updatedByUserId: v.updatedByUserId,
    document,
  };
  if (v.revisionMeta && typeof v.revisionMeta === "object") {
    envelope.revisionMeta = v.revisionMeta as RevisionMeta;
  }
  return envelope;
}
