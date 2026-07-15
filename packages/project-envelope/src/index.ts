/**
 * @experimental R1 blocksync.project/v1 envelope helpers.
 */

import { createHash } from "node:crypto";
import {
  emptyProject,
  type ProjectDocument,
  type ScratchBlock,
  type ScratchTarget,
} from "@blocksync/project-schema";

export const PROJECT_FORMAT = "blocksync.project/v1" as const;

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
}

export type RequestOp = "save_document" | "restore";

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

function canonicalizeBlock(block: ScratchBlock): Record<string, unknown> {
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

function canonicalizeTarget(target: ScratchTarget): Record<string, unknown> {
  const blockIds = Object.keys(target.blocks).sort();
  const blocks: Record<string, unknown> = {};
  for (const id of blockIds) {
    blocks[id] = canonicalizeBlock(target.blocks[id]!);
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

/** Deterministic UTF-8 JSON covering the entire ProjectDocument. */
export function canonicalizeDocument(doc: ProjectDocument): string {
  const targets = [...doc.targets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(canonicalizeTarget);
  const extensions = [...(doc.extensions ?? [])].sort();
  const meta = sortKeysDeep(doc.meta ?? {}) as Record<string, unknown>;
  return JSON.stringify({
    schemaVersion: doc.schemaVersion,
    extensions,
    meta,
    targets,
  });
}

export function contentHash(doc: ProjectDocument): string {
  return createHash("sha256").update(canonicalizeDocument(doc)).digest("hex");
}

export function requestHash(args: {
  op: RequestOp;
  schemaVersion: number;
  contentHash: string;
}): string {
  const material = JSON.stringify({
    contentHash: args.contentHash,
    op: args.op,
    schemaVersion: args.schemaVersion,
  });
  return createHash("sha256").update(material).digest("hex");
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
  return {
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
}
