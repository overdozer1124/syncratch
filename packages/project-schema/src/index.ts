/**
 * @experimental Gate 0 only — API may change without notice for Release 1.
 * Pure domain model: no Scratch VM, Yjs, or React dependencies.
 */

import { allowedExtensionIdSet, allowedOpcodeSet } from "./scratch-opcodes.js";

export type BlockId = string;
export type TargetId = string;

export interface CostumeRef {
  kind: "costume";
  name: string;
  assetId: string;
  md5ext: string;
  dataFormat: string;
  contentSha256: string;
  rotationCenterX: number;
  rotationCenterY: number;
  bitmapResolution?: number;
}

export interface SoundRef {
  kind: "sound";
  name: string;
  assetId: string;
  md5ext: string;
  dataFormat: string;
  contentSha256: string;
  rate: number;
  sampleCount: number;
  format: string;
}

export interface ScratchBlock {
  id: BlockId;
  opcode: string;
  next: BlockId | null;
  parent: BlockId | null;
  inputs: Record<string, unknown>;
  fields: Record<string, unknown>;
  shadow?: boolean;
  topLevel?: boolean;
  x?: number;
  y?: number;
  mutation?: Record<string, unknown>;
}

export interface ScratchTarget {
  id: TargetId;
  name: string;
  isStage: boolean;
  blocks: Record<BlockId, ScratchBlock>;
  variables?: Record<string, [string, string | number]>;
  lists?: Record<string, [string, unknown[]]>;
  broadcasts?: Record<string, string>;
  /** SB3: normalized to {} on import/export (§6.4). */
  comments?: Record<string, unknown>;
  /** schemaVersion ≥ 2 (§6.4). */
  currentCostume?: number;
  costumes?: CostumeRef[];
  sounds?: SoundRef[];
  volume?: number;
  layerOrder?: number;
  tempo?: number;
  videoTransparency?: number;
  videoState?: string;
  textToSpeechLanguage?: string | null;
  visible?: boolean;
  x?: number;
  y?: number;
  size?: number;
  direction?: number;
  draggable?: boolean;
  rotationStyle?: string;
}

export interface ProjectDocument {
  schemaVersion: number;
  targets: ScratchTarget[];
  extensions?: string[];
  meta?: Record<string, unknown>;
  /** SB3: normalized to [] on import/export (§6.4). */
  monitors?: unknown[];
}

export type ValidationCode =
  | "DUPLICATE_BLOCK_ID"
  | "DUPLICATE_TARGET_ID"
  | "DUPLICATE_SPRITE_NAME"
  | "BLOCK_ID_MISMATCH"
  | "PARENT_NEXT_MISMATCH"
  | "CYCLE_DETECTED"
  | "TOPLEVEL_HAS_PARENT"
  | "INPUT_MULTI_OCCUPANT"
  | "MISSING_VARIABLE_REF"
  | "MISSING_LIST_REF"
  | "MISSING_BROADCAST_REF"
  | "MISSING_TARGET_REF"
  | "UNKNOWN_BLOCK_REF"
  | "UNKNOWN_OPCODE"
  | "ORPHAN_NON_TOPLEVEL"
  | "EXTENSION_NOT_ALLOWED"
  | "DISALLOWED_EXTENSION_ID"
  | "INVALID_MONITORS"
  | "INVALID_COMMENTS"
  | "DISALLOWED_BLOCK_FIELD"
  | "DISALLOWED_V1_FIELD"
  | "INVALID_CURRENT_COSTUME"
  | "UNKNOWN_DOCUMENT_FIELD"
  | "INVALID_DOCUMENT";

export interface ValidationIssue {
  code: ValidationCode;
  message: string;
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  /** Explicit allow-list of extension ids (e.g. "music", "pen"). */
  allowedExtensions?: string[];
  /** Exact opcode allow-list; defaults to scratch-opcodes-v14.1.0.json. */
  allowedOpcodes?: ReadonlySet<string>;
  /** Enforce §6.4 comments/monitors policy and §6.6 opcode set. Default true. */
  enforceSb3Policy?: boolean;
}

export {
  allowedExtensionIdSet,
  allowedOpcodeSet,
  CORPUS_OPCODES,
  loadOpcodeArtifact,
} from "./scratch-opcodes.js";
export type { OpcodeArtifact } from "./scratch-opcodes.js";

function issue(
  code: ValidationCode,
  message: string,
  path?: string,
): ValidationIssue {
  return { code, message, path };
}

/** Collect block ids referenced from an input value (primary + optional shadow). */
export function extractBlockRefsFromInput(value: unknown): BlockId[] {
  if (!Array.isArray(value) || value.length < 2) return [];
  const refs: BlockId[] = [];
  // Scratch: [type, blockId] | [type, blockId, shadowId] | [type, [shadowPrimitive]]
  if (typeof value[1] === "string") refs.push(value[1]);
  if (typeof value[2] === "string") refs.push(value[2]);
  return refs;
}

function variableIds(doc: ProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const t of doc.targets) {
    for (const id of Object.keys(t.variables ?? {})) ids.add(id);
  }
  return ids;
}

function listIds(doc: ProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const t of doc.targets) {
    for (const id of Object.keys(t.lists ?? {})) ids.add(id);
  }
  return ids;
}

function broadcastIds(doc: ProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const t of doc.targets) {
    for (const id of Object.keys(t.broadcasts ?? {})) ids.add(id);
  }
  return ids;
}

/** next + input edges for cycle detection within a target. */
function hasDirectedCycle(blocks: Record<BlockId, ScratchBlock>): boolean {
  const visiting = new Set<BlockId>();
  const visited = new Set<BlockId>();

  const neighbors = (id: BlockId): BlockId[] => {
    const b = blocks[id];
    if (!b) return [];
    const out: BlockId[] = [];
    if (b.next && blocks[b.next]) out.push(b.next);
    for (const inp of Object.values(b.inputs ?? {})) {
      for (const ref of extractBlockRefsFromInput(inp)) {
        if (blocks[ref]) out.push(ref);
      }
    }
    return out;
  };

  const dfs = (id: BlockId): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const n of neighbors(id)) {
      if (dfs(n)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const id of Object.keys(blocks)) {
    if (dfs(id)) return true;
  }
  return false;
}

/**
 * Scratch extension opcodes are typically `extensionId_blockName` (underscore)
 * and the extension id is listed in project.extensions.
 */
export function extensionIdFromOpcode(opcode: string): string | null {
  if (!opcode || opcode.startsWith("event_")) return null;
  // Built-in categories use prefixes that are not extensions
  const builtins = [
    "motion_",
    "looks_",
    "sound_",
    "event_",
    "control_",
    "sensing_",
    "operator_",
    "data_",
    "procedures_",
    "argument_",
  ];
  if (builtins.some((p) => opcode.startsWith(p))) return null;
  const idx = opcode.indexOf("_");
  if (idx <= 0) return null;
  return opcode.slice(0, idx);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DOCUMENT_FIELDS_V1 = [
  "schemaVersion",
  "targets",
  "extensions",
  "meta",
] as const;

const DOCUMENT_FIELDS_V2 = [...DOCUMENT_FIELDS_V1, "monitors"] as const;

const TARGET_FIELDS_V1 = [
  "id",
  "name",
  "isStage",
  "blocks",
  "variables",
  "lists",
  "broadcasts",
] as const;

const TARGET_FIELDS_V2_COMMON = [
  ...TARGET_FIELDS_V1,
  "comments",
  "currentCostume",
  "costumes",
  "sounds",
  "volume",
  "layerOrder",
] as const;

const TARGET_FIELDS_V2_STAGE = [
  ...TARGET_FIELDS_V2_COMMON,
  "tempo",
  "videoTransparency",
  "videoState",
  "textToSpeechLanguage",
] as const;

const TARGET_FIELDS_V2_SPRITE = [
  ...TARGET_FIELDS_V2_COMMON,
  "visible",
  "x",
  "y",
  "size",
  "direction",
  "draggable",
  "rotationStyle",
] as const;

const BLOCK_FIELDS_V1 = [
  "id",
  "opcode",
  "next",
  "parent",
  "inputs",
  "fields",
  "shadow",
  "topLevel",
  "x",
  "y",
] as const;

const BLOCK_FIELDS_V2 = [...BLOCK_FIELDS_V1, "mutation"] as const;

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      issues.push(
        issue(
          "UNKNOWN_DOCUMENT_FIELD",
          `unknown field ${key}`,
          path ? `${path}.${key}` : key,
        ),
      );
    }
  }
}

function validateDocumentFieldAllowList(
  doc: ProjectDocument,
  issues: ValidationIssue[],
): void {
  const docAllowed =
    doc.schemaVersion >= 2 ? DOCUMENT_FIELDS_V2 : DOCUMENT_FIELDS_V1;
  rejectUnknownKeys(
    doc as unknown as Record<string, unknown>,
    docAllowed,
    "",
    issues,
  );

  for (const target of doc.targets) {
    if (!target || typeof target.id !== "string") continue;
    const targetAllowed =
      doc.schemaVersion >= 2
        ? target.isStage
          ? TARGET_FIELDS_V2_STAGE
          : TARGET_FIELDS_V2_SPRITE
        : TARGET_FIELDS_V1;
    rejectUnknownKeys(
      target as unknown as Record<string, unknown>,
      targetAllowed,
      `targets.${target.id}`,
      issues,
    );

    const blockAllowed =
      doc.schemaVersion >= 2 ? BLOCK_FIELDS_V2 : BLOCK_FIELDS_V1;
    for (const [blockId, block] of Object.entries(target.blocks ?? {})) {
      if (!block || typeof block !== "object") continue;
      rejectUnknownKeys(
        block as unknown as Record<string, unknown>,
        blockAllowed,
        `targets.${target.id}.blocks.${blockId}`,
        issues,
      );
    }
  }
}

function validateV2TargetAssets(
  target: ScratchTarget,
  issues: ValidationIssue[],
): void {
  const path = `targets.${target.id}`;
  const costumeCount = Array.isArray(target.costumes)
    ? target.costumes.length
    : 0;

  if (!Array.isArray(target.costumes) || costumeCount === 0) {
    issues.push(
      issue(
        "INVALID_DOCUMENT",
        "costumes must be a non-empty array on schemaVersion 2",
        `${path}.costumes`,
      ),
    );
  }

  if (target.currentCostume === undefined) {
    issues.push(
      issue(
        "INVALID_CURRENT_COSTUME",
        "currentCostume is required on schemaVersion 2",
        `${path}.currentCostume`,
      ),
    );
    return;
  }

  const idx = target.currentCostume;
  if (!Number.isInteger(idx) || idx < 0 || idx >= costumeCount) {
    issues.push(
      issue(
        "INVALID_CURRENT_COSTUME",
        `currentCostume ${String(idx)} is out of range for ${costumeCount} costumes`,
        `${path}.currentCostume`,
      ),
    );
  }
}

const V1_FORBIDDEN_TARGET_FIELDS = [
  "comments",
  "currentCostume",
  "costumes",
  "sounds",
  "volume",
  "layerOrder",
  "tempo",
  "videoTransparency",
  "videoState",
  "textToSpeechLanguage",
  "visible",
  "size",
  "direction",
  "draggable",
  "rotationStyle",
] as const;

function validateV1OnlyFields(
  doc: ProjectDocument,
  issues: ValidationIssue[],
): void {
  if (doc.schemaVersion !== 1) return;

  if (doc.monitors !== undefined) {
    issues.push(
      issue(
        "DISALLOWED_V1_FIELD",
        "monitors is not allowed on schemaVersion 1",
        "monitors",
      ),
    );
  }

  for (const target of doc.targets) {
    const targetPath = `targets.${target.id}`;
    for (const field of V1_FORBIDDEN_TARGET_FIELDS) {
      if ((target as Record<string, unknown>)[field] !== undefined) {
        issues.push(
          issue(
            "DISALLOWED_V1_FIELD",
            `${field} is not allowed on schemaVersion 1`,
            `${targetPath}.${field}`,
          ),
        );
      }
    }
    if (!target.isStage) {
      if (target.x !== undefined) {
        issues.push(
          issue(
            "DISALLOWED_V1_FIELD",
            "x is not allowed on schemaVersion 1 sprites",
            `${targetPath}.x`,
          ),
        );
      }
      if (target.y !== undefined) {
        issues.push(
          issue(
            "DISALLOWED_V1_FIELD",
            "y is not allowed on schemaVersion 1 sprites",
            `${targetPath}.y`,
          ),
        );
      }
    }

    for (const [mapKey, block] of Object.entries(target.blocks ?? {})) {
      if (block.mutation !== undefined) {
        issues.push(
          issue(
            "DISALLOWED_V1_FIELD",
            "mutation is not allowed on schemaVersion 1 blocks",
            `${targetPath}.blocks.${mapKey}.mutation`,
          ),
        );
      }
    }
  }
}

/**
 * Validates structural invariants (spec §16).
 * Rejects entirely — callers must not partially apply.
 */
export function validateProject(
  doc: ProjectDocument,
  options: ValidateOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!doc || !Array.isArray(doc.targets)) {
    return {
      ok: false,
      issues: [
        issue("INVALID_DOCUMENT", "targets must be an array"),
      ],
    };
  }

  const enforceSb3 = options.enforceSb3Policy !== false;
  const opcodeAllow =
    options.allowedOpcodes ?? (enforceSb3 ? allowedOpcodeSet() : null);
  const extensionIdAllow = enforceSb3 ? allowedExtensionIdSet() : null;

  validateV1OnlyFields(doc, issues);

  if (enforceSb3) {
    validateDocumentFieldAllowList(doc, issues);
  }

  if (doc.monitors !== undefined) {
    if (!Array.isArray(doc.monitors)) {
      issues.push(
        issue(
          "INVALID_MONITORS",
          "monitors must be an array",
          "monitors",
        ),
      );
    } else if (enforceSb3 && doc.monitors.length > 0) {
      issues.push(
        issue(
          "INVALID_MONITORS",
          "monitors must be empty (normalized to [] on export)",
          "monitors",
        ),
      );
    }
  }

  if (enforceSb3 && doc.extensions) {
    for (const extId of doc.extensions) {
      if (extensionIdAllow && !extensionIdAllow.has(extId)) {
        issues.push(
          issue(
            "DISALLOWED_EXTENSION_ID",
            `Extension id ${extId} is not in §6.6.2 allow-list`,
            `extensions.${extId}`,
          ),
        );
      }
    }
  }

  const globalBlockIds = new Set<BlockId>();
  const targetIds = new Set<string>();
  const spriteNames = new Map<string, string>();
  const varIds = variableIds(doc);
  const listIdSet = listIds(doc);
  const broadcastIdSet = broadcastIds(doc);
  const serverAllowedExt = new Set(options.allowedExtensions ?? []);

  for (const target of doc.targets) {
    if (!target || typeof target.id !== "string" || !target.id) {
      issues.push(issue("INVALID_DOCUMENT", "target.id is required"));
      continue;
    }
    if (targetIds.has(target.id)) {
      issues.push(
        issue(
          "DUPLICATE_TARGET_ID",
          `Target id ${target.id} is duplicated`,
          `targets.${target.id}`,
        ),
      );
    }
    targetIds.add(target.id);

    if (target.comments !== undefined) {
      if (!isPlainRecord(target.comments)) {
        issues.push(
          issue(
            "INVALID_COMMENTS",
            "comments must be a plain object",
            `targets.${target.id}.comments`,
          ),
        );
      } else if (
        enforceSb3 &&
        Object.keys(target.comments).length > 0
      ) {
        issues.push(
          issue(
            "INVALID_COMMENTS",
            "target comments must be empty (normalized to {} on export)",
            `targets.${target.id}.comments`,
          ),
        );
      }
    }

    if (enforceSb3 && doc.schemaVersion >= 2) {
      validateV2TargetAssets(target, issues);
    }

    if (enforceSb3 && !target.isStage) {
      const prev = spriteNames.get(target.name);
      if (prev) {
        issues.push(
          issue(
            "DUPLICATE_SPRITE_NAME",
            `Sprite name ${target.name} is duplicated`,
            `targets.${target.id}.name`,
          ),
        );
      } else {
        spriteNames.set(target.name, target.id);
      }
    }

    if (!target.blocks || typeof target.blocks !== "object") {
      issues.push(
        issue(
          "INVALID_DOCUMENT",
          "target.blocks must be an object",
          `targets.${target.id}`,
        ),
      );
      continue;
    }

    const blocks = target.blocks;
    const pathBase = `targets.${target.id}`;

    for (const [mapKey, block] of Object.entries(blocks)) {
      const path = `${pathBase}.blocks.${mapKey}`;
      if (!block || typeof block !== "object") {
        issues.push(issue("INVALID_DOCUMENT", "invalid block object", path));
        continue;
      }
      if (block.id !== mapKey) {
        issues.push(
          issue(
            "BLOCK_ID_MISMATCH",
            `Map key ${mapKey} !== block.id ${String(block.id)}`,
            path,
          ),
        );
      }
      if (globalBlockIds.has(mapKey)) {
        issues.push(
          issue(
            "DUPLICATE_BLOCK_ID",
            `Block id ${mapKey} is not unique in project`,
            path,
          ),
        );
      }
      globalBlockIds.add(mapKey);
    }

    if (hasDirectedCycle(blocks)) {
      issues.push(
        issue(
          "CYCLE_DETECTED",
          `Cycle in next/input graph of target ${target.id}`,
          pathBase,
        ),
      );
    }

    for (const [id, block] of Object.entries(blocks)) {
      const path = `${pathBase}.blocks.${id}`;

      if (
        enforceSb3 &&
        "comment" in block &&
        (block as Record<string, unknown>).comment !== undefined
      ) {
        issues.push(
          issue(
            "DISALLOWED_BLOCK_FIELD",
            "block comment field is not allowed",
            path,
          ),
        );
      }

      if (opcodeAllow && !opcodeAllow.has(block.opcode ?? "")) {
        issues.push(
          issue(
            "UNKNOWN_OPCODE",
            `opcode ${block.opcode} is not in allow-list`,
            path,
          ),
        );
      }

      if (block.topLevel && block.parent) {
        issues.push(
          issue(
            "TOPLEVEL_HAS_PARENT",
            `Top-level block ${id} must not have parent`,
            path,
          ),
        );
      }

      if (block.parent) {
        const parent = blocks[block.parent];
        if (!parent) {
          issues.push(
            issue(
              "UNKNOWN_BLOCK_REF",
              `parent ${block.parent} missing`,
              path,
            ),
          );
        } else {
          const referenced =
            parent.next === id ||
            Object.values(parent.inputs ?? {}).some((inp) =>
              extractBlockRefsFromInput(inp).includes(id),
            );
          if (!referenced) {
            issues.push(
              issue(
                "PARENT_NEXT_MISMATCH",
                `parent ${block.parent} does not reference child ${id}`,
                path,
              ),
            );
          }
        }
      }

      if (block.next) {
        const next = blocks[block.next];
        if (!next) {
          issues.push(
            issue("UNKNOWN_BLOCK_REF", `next ${block.next} missing`, path),
          );
        } else if (next.parent !== id) {
          issues.push(
            issue(
              "PARENT_NEXT_MISMATCH",
              `next ${block.next} parent must be ${id}`,
              path,
            ),
          );
        }
      }

      // Single occupant per input slot: type 2/3 blocks may list primary + shadow,
      // but two distinct non-shadow block ids in one slot is invalid.
      for (const [inputName, inputVal] of Object.entries(block.inputs ?? {})) {
        if (!Array.isArray(inputVal)) continue;
        const refs = extractBlockRefsFromInput(inputVal).filter(
          (ref) => blocks[ref] && !blocks[ref]!.shadow,
        );
        const unique = new Set(refs);
        if (unique.size > 1) {
          issues.push(
            issue(
              "INPUT_MULTI_OCCUPANT",
              `input ${inputName} has multiple non-shadow occupants`,
              `${path}.inputs.${inputName}`,
            ),
          );
        }
        for (const ref of extractBlockRefsFromInput(inputVal)) {
          if (!blocks[ref] && typeof ref === "string" && ref.length >= 8) {
            // Primitive shadows use nested arrays, not long uid strings
            issues.push(
              issue(
                "UNKNOWN_BLOCK_REF",
                `input ${inputName} references missing block ${ref}`,
                `${path}.inputs.${inputName}`,
              ),
            );
          }
        }
      }

      for (const [fieldName, fieldVal] of Object.entries(block.fields ?? {})) {
        if (!Array.isArray(fieldVal)) continue;
        const refId = fieldVal[1];
        // Clone / go-to target name fields store [name, null] or [name, id]
        if (
          (fieldName === "TO" ||
            fieldName === "TOWARDS" ||
            fieldName === "CLONE_OPTION") &&
          typeof fieldVal[0] === "string" &&
          fieldVal[0] !== "_myself_" &&
          fieldVal[0] !== "_random_" &&
          fieldVal[0] !== "_mouse_"
        ) {
          const name = fieldVal[0];
          const byName = doc.targets.some((t) => t.name === name);
          const byId =
            typeof refId === "string" && refId.length > 0
              ? targetIds.has(refId)
              : false;
          if (!byName && !byId) {
            issues.push(
              issue(
                "MISSING_TARGET_REF",
                `Target reference ${name} not found`,
                `${path}.fields.${fieldName}`,
              ),
            );
          }
        }
        if (typeof refId !== "string") continue;
        if (fieldName === "VARIABLE" && !varIds.has(refId)) {
          issues.push(
            issue(
              "MISSING_VARIABLE_REF",
              `VARIABLE field references unknown id ${refId}`,
              `${path}.fields.${fieldName}`,
            ),
          );
        }
        if (fieldName === "LIST" && !listIdSet.has(refId)) {
          issues.push(
            issue(
              "MISSING_LIST_REF",
              `LIST field references unknown id ${refId}`,
              `${path}.fields.${fieldName}`,
            ),
          );
        }
        if (fieldName === "BROADCAST_OPTION" && !broadcastIdSet.has(refId)) {
          issues.push(
            issue(
              "MISSING_BROADCAST_REF",
              `BROADCAST references unknown id ${refId}`,
              `${path}.fields.${fieldName}`,
            ),
          );
        }
      }

      const ext = extensionIdFromOpcode(block.opcode ?? "");
      if (ext) {
        const declared = doc.extensions ?? [];
        if (!declared.includes(ext)) {
          issues.push(
            issue(
              "EXTENSION_NOT_ALLOWED",
              `Extension ${ext} must be listed in project.extensions for opcode ${block.opcode}`,
              path,
            ),
          );
        }
        if (
          options.allowedExtensions !== undefined &&
          !serverAllowedExt.has(ext)
        ) {
          issues.push(
            issue(
              "EXTENSION_NOT_ALLOWED",
              `Extension ${ext} is not in server allow-list for opcode ${block.opcode}`,
              path,
            ),
          );
        }
      }
    }

    const referenced = new Set<BlockId>();
    for (const b of Object.values(blocks)) {
      if (b.next) referenced.add(b.next);
      for (const inp of Object.values(b.inputs ?? {})) {
        for (const ref of extractBlockRefsFromInput(inp)) referenced.add(ref);
      }
    }
    for (const [id, b] of Object.entries(blocks)) {
      if (b.topLevel) continue;
      if (b.parent === null && !referenced.has(id)) {
        issues.push(
          issue(
            "ORPHAN_NON_TOPLEVEL",
            `Block ${id} is not top-level and not referenced`,
            `${pathBase}.blocks.${id}`,
          ),
        );
      }
    }
  }

  const dedup = new Map<string, ValidationIssue>();
  for (const i of issues) {
    const key = `${i.code}:${i.path ?? ""}:${i.message}`;
    if (!dedup.has(key)) dedup.set(key, i);
  }
  const unique = [...dedup.values()];
  return { ok: unique.length === 0, issues: unique };
}

export function emptyProject(): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
      },
    ],
    extensions: [],
  };
}
