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

/** SB3 blocks map entry: object block or primitive shadow array (§6.5). */
export type BlockMapEntry = ScratchBlock | unknown[];

export function isScratchBlock(entry: BlockMapEntry): entry is ScratchBlock {
  return !Array.isArray(entry);
}

function isPrimitiveFieldValue(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number";
}

export function isPrimitiveBlockEntry(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length < 2) return false;
  const tag = value[0];
  if (typeof tag !== "number" || tag < 4 || tag > 13) return false;
  if (!isPrimitiveFieldValue(value[1])) return false;

  if (tag >= 4 && tag <= 10) {
    return value.length === 2;
  }
  if (tag === 11) {
    return value.length === 3 && typeof value[2] === "string";
  }
  if (tag === 12 || tag === 13) {
    if (value.length === 3) {
      return typeof value[2] === "string";
    }
    if (value.length === 5) {
      return (
        typeof value[2] === "string" &&
        typeof value[3] === "number" &&
        typeof value[4] === "number"
      );
    }
    return false;
  }
  return false;
}

export function canonicalAssetDataFormat(format: string): string {
  return format === "jpeg" ? "jpg" : format.toLowerCase();
}

const MUTATION_REQUIRED_KEYS: Record<string, readonly string[]> = {
  procedures_prototype: [
    "tagName",
    "children",
    "proccode",
    "argumentids",
    "argumentnames",
    "argumentdefaults",
    "warp",
  ],
  procedures_call: [
    "tagName",
    "children",
    "proccode",
    "argumentids",
    "warp",
  ],
};

function validateAssetRefIntegrity(
  ref: { assetId?: string; md5ext?: string; dataFormat?: string },
  path: string,
  issues: ValidationIssue[],
): void {
  const md5ext = ref.md5ext;
  if (typeof md5ext !== "string" || !md5ext) {
    issues.push(
      issue("INVALID_ASSET_REF", "md5ext is required", `${path}.md5ext`),
    );
    return;
  }
  const dot = md5ext.lastIndexOf(".");
  if (dot <= 0) {
    issues.push(
      issue(
        "INVALID_ASSET_REF",
        "md5ext must include an extension suffix",
        `${path}.md5ext`,
      ),
    );
    return;
  }
  const stem = md5ext.slice(0, dot);
  const suffix = md5ext.slice(dot + 1);
  if (typeof ref.assetId !== "string" || !ref.assetId) {
    issues.push(
      issue("INVALID_ASSET_REF", "assetId is required", `${path}.assetId`),
    );
    return;
  }
  if (stem !== ref.assetId) {
    issues.push(
      issue(
        "INVALID_ASSET_REF",
        "md5ext stem must equal assetId",
        `${path}.md5ext`,
      ),
    );
  }
  if (typeof ref.dataFormat !== "string" || !ref.dataFormat) {
    issues.push(
      issue("INVALID_ASSET_REF", "dataFormat is required", `${path}.dataFormat`),
    );
    return;
  }
  const suffixLower = suffix.toLowerCase();
  if (suffixLower === "jpeg") {
    issues.push(
      issue(
        "INVALID_ASSET_REF",
        "md5ext suffix must use canonical jpg not jpeg",
        `${path}.md5ext`,
      ),
    );
    return;
  }
  const canonicalFormat = canonicalAssetDataFormat(ref.dataFormat);
  if (canonicalFormat !== suffixLower) {
    issues.push(
      issue(
        "INVALID_ASSET_REF",
        "dataFormat must match md5ext extension",
        `${path}.dataFormat`,
      ),
    );
  }
}

function validateSb3InputBlockRef(
  ref: string,
  path: string,
  blocks: Record<BlockId, BlockMapEntry>,
  issues: ValidationIssue[],
): void {
  if (!(ref in blocks)) {
    issues.push(
      issue(
        "UNKNOWN_BLOCK_REF",
        `input references missing block ${ref}`,
        path,
      ),
    );
  }
}

function validateSb3InputDescriptor(
  descriptor: unknown,
  path: string,
  blocks: Record<BlockId, BlockMapEntry>,
  issues: ValidationIssue[],
): void {
  if (typeof descriptor === "string") {
    validateSb3InputBlockRef(descriptor, path, blocks, issues);
    return;
  }
  if (Array.isArray(descriptor)) {
    if (!isPrimitiveBlockEntry(descriptor)) {
      issues.push(
        issue(
          "INVALID_INPUT_ENCODING",
          "invalid inline primitive in input",
          path,
        ),
      );
    }
    return;
  }
  issues.push(
    issue(
      "INVALID_INPUT_ENCODING",
      "input descriptor must be block id or primitive array",
      path,
    ),
  );
}

function validateSb3InputEncoding(
  inputVal: unknown,
  path: string,
  blocks: Record<BlockId, BlockMapEntry>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(inputVal) || inputVal.length < 2) {
    issues.push(
      issue(
        "INVALID_INPUT_ENCODING",
        "input must be a non-empty SB3 array",
        path,
      ),
    );
    return;
  }
  const mode = inputVal[0];
  if (mode === 1) {
    if (inputVal.length !== 2) {
      issues.push(
        issue(
          "INVALID_INPUT_ENCODING",
          "input mode 1 must have length 2",
          path,
        ),
      );
      return;
    }
    validateSb3InputDescriptor(inputVal[1], path, blocks, issues);
    return;
  }
  if (mode === 2) {
    if (inputVal.length !== 2) {
      issues.push(
        issue(
          "INVALID_INPUT_ENCODING",
          "input mode 2 must have length 2",
          path,
        ),
      );
      return;
    }
    validateSb3InputDescriptor(inputVal[1], path, blocks, issues);
    return;
  }
  if (mode === 3) {
    if (inputVal.length !== 3) {
      issues.push(
        issue(
          "INVALID_INPUT_ENCODING",
          "input mode 3 must have length 3",
          path,
        ),
      );
      return;
    }
    validateSb3InputDescriptor(inputVal[1], `${path}[1]`, blocks, issues);
    validateSb3InputDescriptor(inputVal[2], `${path}[2]`, blocks, issues);
    return;
  }
  issues.push(
    issue(
      "INVALID_INPUT_ENCODING",
      `unknown input mode ${String(mode)}`,
      path,
    ),
  );
}

function validateSb3FieldEncoding(
  fieldVal: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(fieldVal)) {
    issues.push(
      issue("INVALID_FIELD_ENCODING", "field must be an SB3 array", path),
    );
    return;
  }
  if (fieldVal.length !== 1 && fieldVal.length !== 2) {
    issues.push(
      issue(
        "INVALID_FIELD_ENCODING",
        "field array must have length 1 or 2",
        path,
      ),
    );
    return;
  }
  const value = fieldVal[0];
  if (typeof value !== "string" && typeof value !== "number") {
    issues.push(
      issue(
        "INVALID_FIELD_ENCODING",
        "field value must be string or number",
        path,
      ),
    );
  }
  if (
    fieldVal.length === 2 &&
    fieldVal[1] !== null &&
    typeof fieldVal[1] !== "string"
  ) {
    issues.push(
      issue(
        "INVALID_FIELD_ENCODING",
        "field id must be string or null",
        path,
      ),
    );
  }
}

function parseMutationJsonStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string[] | null {
  if (typeof value !== "string") {
    issues.push(
      issue("INVALID_MUTATION", "expected JSON string array", path),
    );
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((entry) => typeof entry === "string")
    ) {
      issues.push(
        issue("INVALID_MUTATION", "expected JSON array of strings", path),
      );
      return null;
    }
    return parsed;
  } catch {
    issues.push(issue("INVALID_MUTATION", "invalid JSON string", path));
    return null;
  }
}

function parseMutationJsonArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): unknown[] | null {
  if (typeof value !== "string") {
    issues.push(issue("INVALID_MUTATION", "expected JSON string array", path));
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      issues.push(issue("INVALID_MUTATION", "expected JSON array", path));
      return null;
    }
    return parsed;
  } catch {
    issues.push(issue("INVALID_MUTATION", "invalid JSON string", path));
    return null;
  }
}

/** Count %s / %b / %n placeholders in a Scratch procedure proccode (vendor sb2.js). */
export function countProcedurePlaceholders(proccode: string): number {
  const parts = proccode.split(/(?=[^\\]%[nbs])/);
  let count = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (
      trimmed.startsWith("%") &&
      (trimmed[1] === "n" || trimmed[1] === "b" || trimmed[1] === "s")
    ) {
      count += 1;
    }
  }
  return count;
}

function validateProcedureArgumentIds(
  proccode: string,
  ids: string[] | null,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!ids) return;
  const placeholders = countProcedurePlaceholders(proccode);
  if (placeholders !== ids.length) {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "proccode placeholder count must match argumentids length",
        path,
      ),
    );
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push(
        issue(
          "INVALID_MUTATION",
          `duplicate argument id ${id}`,
          path,
        ),
      );
    }
    seen.add(id);
  }
}

function validatePrototypeWarpField(
  warp: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (warp !== "true" && warp !== "false") {
    issues.push(
      issue(
        "INVALID_MUTATION",
        'warp must be string "true" or "false"',
        path,
      ),
    );
  }
}

function validateCallWarpField(
  warp: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (warp !== "true" && warp !== "false" && warp !== "null") {
    issues.push(
      issue(
        "INVALID_MUTATION",
        'warp must be string "true", "false", or "null"',
        path,
      ),
    );
  }
}

function validatePrototypeMutationShape(
  mutation: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (mutation.tagName !== "mutation") {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "tagName must be mutation",
        `${path}.tagName`,
      ),
    );
  }
  if (!Array.isArray(mutation.children)) {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "children must be an array",
        `${path}.children`,
      ),
    );
  }
  if (typeof mutation.proccode !== "string" || !mutation.proccode) {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "proccode must be a non-empty string",
        `${path}.proccode`,
      ),
    );
  }
  const ids = parseMutationJsonStringArray(
    mutation.argumentids,
    `${path}.argumentids`,
    issues,
  );
  const names = parseMutationJsonStringArray(
    mutation.argumentnames,
    `${path}.argumentnames`,
    issues,
  );
  const defaults = parseMutationJsonArray(
    mutation.argumentdefaults,
    `${path}.argumentdefaults`,
    issues,
  );
  if (ids && names && ids.length !== names.length) {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "argumentids and argumentnames length mismatch",
        path,
      ),
    );
  }
  if (ids && defaults && ids.length !== defaults.length) {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "argumentids and argumentdefaults length mismatch",
        path,
      ),
    );
  }
  if (typeof mutation.proccode === "string") {
    validateProcedureArgumentIds(
      mutation.proccode,
      ids,
      `${path}.argumentids`,
      issues,
    );
  }
  validatePrototypeWarpField(mutation.warp, `${path}.warp`, issues);
}

function validateCallMutationShape(
  block: ScratchBlock,
  mutation: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (mutation.tagName !== "mutation") {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "tagName must be mutation",
        `${path}.tagName`,
      ),
    );
  }
  if (!Array.isArray(mutation.children)) {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "children must be an array",
        `${path}.children`,
      ),
    );
  }
  if (typeof mutation.proccode !== "string" || !mutation.proccode) {
    issues.push(
      issue(
        "INVALID_MUTATION",
        "proccode must be a non-empty string",
        `${path}.proccode`,
      ),
    );
  }
  const ids = parseMutationJsonStringArray(
    mutation.argumentids,
    `${path}.argumentids`,
    issues,
  );
  validateCallWarpField(mutation.warp, `${path}.warp`, issues);
  if (typeof mutation.proccode === "string") {
    validateProcedureArgumentIds(
      mutation.proccode,
      ids,
      `${path}.argumentids`,
      issues,
    );
  }
  if (ids) {
    const inputKeys = Object.keys(block.inputs ?? {});
    if (ids.length !== inputKeys.length) {
      issues.push(
        issue(
          "INVALID_MUTATION",
          "argumentids length must match procedures_call input count",
          `${path}.argumentids`,
        ),
      );
    }
    for (const id of ids) {
      if (!inputKeys.includes(id)) {
        issues.push(
          issue(
            "INVALID_MUTATION",
            `argument id ${id} missing from procedures_call inputs`,
            `${path}.argumentids`,
          ),
        );
      }
    }
  }
}

function validateRequiredMutation(
  block: ScratchBlock,
  path: string,
  issues: ValidationIssue[],
): void {
  const required = MUTATION_REQUIRED_KEYS[block.opcode];
  if (!required) return;
  if (!block.mutation || typeof block.mutation !== "object") {
    issues.push(
      issue(
        "MISSING_MUTATION",
        `${block.opcode} requires mutation`,
        `${path}.mutation`,
      ),
    );
    return;
  }
  const mutation = block.mutation as Record<string, unknown>;
  for (const key of required) {
    if (!(key in mutation)) {
      issues.push(
        issue(
          "MISSING_MUTATION",
          `mutation.${key} is required for ${block.opcode}`,
          `${path}.mutation.${key}`,
        ),
      );
    }
  }
  if (block.opcode === "procedures_prototype") {
    validatePrototypeMutationShape(mutation, `${path}.mutation`, issues);
  } else if (block.opcode === "procedures_call") {
    validateCallMutationShape(block, mutation, `${path}.mutation`, issues);
  }
}

export interface ScratchTarget {
  id: TargetId;
  name: string;
  isStage: boolean;
  blocks: Record<BlockId, BlockMapEntry>;
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
  | "INVALID_INPUT_ENCODING"
  | "INVALID_FIELD_ENCODING"
  | "INVALID_ASSET_REF"
  | "MISSING_MUTATION"
  | "INVALID_MUTATION"
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
export {
  assertValidMp3Bytes,
  MAX_MP3_SECONDS,
  Mp3ParseError,
  parseMp3Audio,
  verifyMp3RefAgainstBytes,
} from "./mp3-bytes.js";
export type { ParsedMp3Audio } from "./mp3-bytes.js";

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
function hasDirectedCycle(blocks: Record<BlockId, BlockMapEntry>): boolean {
  const visiting = new Set<BlockId>();
  const visited = new Set<BlockId>();

  const neighbors = (id: BlockId): BlockId[] => {
    const b = blocks[id];
    if (!b || Array.isArray(b)) return [];
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
      if (Array.isArray(block)) continue;
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
  } else {
    for (let i = 0; i < target.costumes.length; i++) {
      validateAssetRefIntegrity(
        target.costumes[i]!,
        `${path}.costumes[${i}]`,
        issues,
      );
    }
  }

  if (Array.isArray(target.sounds)) {
    for (let i = 0; i < target.sounds.length; i++) {
      validateAssetRefIntegrity(
        target.sounds[i]!,
        `${path}.sounds[${i}]`,
        issues,
      );
    }
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
      if ((target as unknown as Record<string, unknown>)[field] !== undefined) {
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
      if (Array.isArray(block)) {
        issues.push(
          issue(
            "DISALLOWED_V1_FIELD",
            "primitive block entry is not allowed on schemaVersion 1",
            `${targetPath}.blocks.${mapKey}`,
          ),
        );
        continue;
      }
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
      if (Array.isArray(block)) {
        if (!isPrimitiveBlockEntry(block)) {
          issues.push(
            issue(
              "INVALID_DOCUMENT",
              "invalid primitive block entry",
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
        continue;
      }
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
      if (Array.isArray(block)) continue;

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
        if (!parent || Array.isArray(parent)) {
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
        } else if (Array.isArray(next) || next.parent !== id) {
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
        if (enforceSb3) {
          validateSb3InputEncoding(
            inputVal,
            `${path}.inputs.${inputName}`,
            blocks,
            issues,
          );
        }
        if (!Array.isArray(inputVal)) continue;
        const refs = extractBlockRefsFromInput(inputVal).filter((ref) => {
          const entry = blocks[ref];
          return entry && !Array.isArray(entry) && !entry.shadow;
        });
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
      }

      for (const [fieldName, fieldVal] of Object.entries(block.fields ?? {})) {
        if (enforceSb3) {
          validateSb3FieldEncoding(
            fieldVal,
            `${path}.fields.${fieldName}`,
            issues,
          );
        }
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

      if (enforceSb3) {
        validateRequiredMutation(block, path, issues);
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
      if (Array.isArray(b)) continue;
      if (b.next) referenced.add(b.next);
      for (const inp of Object.values(b.inputs ?? {})) {
        for (const ref of extractBlockRefsFromInput(inp)) referenced.add(ref);
      }
    }
    for (const [id, b] of Object.entries(blocks)) {
      if (Array.isArray(b)) continue;
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
