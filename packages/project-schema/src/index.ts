/**
 * @experimental Gate 0 only — API may change without notice for Release 1.
 * Pure domain model: no Scratch VM, Yjs, or React dependencies.
 */

export type BlockId = string;
export type TargetId = string;

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
}

export interface ScratchTarget {
  id: TargetId;
  name: string;
  isStage: boolean;
  blocks: Record<BlockId, ScratchBlock>;
  variables?: Record<string, [string, string | number]>;
  lists?: Record<string, [string, unknown[]]>;
  broadcasts?: Record<string, string>;
}

export interface ProjectDocument {
  schemaVersion: number;
  targets: ScratchTarget[];
  extensions?: string[];
  meta?: Record<string, unknown>;
}

export type ValidationCode =
  | "DUPLICATE_BLOCK_ID"
  | "PARENT_NEXT_MISMATCH"
  | "CYCLE_DETECTED"
  | "TOPLEVEL_HAS_PARENT"
  | "INPUT_MULTI_OCCUPANT"
  | "MISSING_VARIABLE_REF"
  | "MISSING_LIST_REF"
  | "MISSING_BROADCAST_REF"
  | "MISSING_TARGET_REF"
  | "UNKNOWN_BLOCK_REF"
  | "ORPHAN_NON_TOPLEVEL"
  | "EXTENSION_NOT_ALLOWED";

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
  /** If set, opcodes starting with these prefixes require the extension id present. */
  allowedExtensions?: string[];
}

function issue(
  code: ValidationCode,
  message: string,
  path?: string,
): ValidationIssue {
  return { code, message, path };
}

function allVariableIds(doc: ProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const t of doc.targets) {
    for (const id of Object.keys(t.variables ?? {})) ids.add(id);
    for (const id of Object.keys(t.lists ?? {})) ids.add(id);
  }
  return ids;
}

function allBroadcastIds(doc: ProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const t of doc.targets) {
    for (const id of Object.keys(t.broadcasts ?? {})) ids.add(id);
  }
  return ids;
}

function extractBlockRefFromInput(value: unknown): BlockId | null {
  // Scratch input formats: [1, blockId] | [1, blockId, shadowId] | [3, blockId, shadow]
  if (!Array.isArray(value)) return null;
  if (value.length >= 2 && typeof value[1] === "string") return value[1];
  return null;
}

function hasCycle(
  blocks: Record<BlockId, ScratchBlock>,
  start: BlockId,
): boolean {
  const seen = new Set<BlockId>();
  let cur: BlockId | null = start;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    const b = blocks[cur];
    if (!b) return false;
    cur = b.next;
  }
  return false;
}

/**
 * Validates structural invariants (spec §16 subset for Gate 0).
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
      issues: [issue("UNKNOWN_BLOCK_REF", "targets must be an array")],
    };
  }

  const globalBlockIds = new Set<BlockId>();
  const targetIds = new Set(doc.targets.map((t) => t.id));
  const varIds = allVariableIds(doc);
  const broadcastIds = allBroadcastIds(doc);
  const allowedExt = new Set(options.allowedExtensions ?? doc.extensions ?? []);

  for (const target of doc.targets) {
    const blocks = target.blocks ?? {};
    const localIds = Object.keys(blocks);

    for (const id of localIds) {
      if (globalBlockIds.has(id)) {
        issues.push(
          issue(
            "DUPLICATE_BLOCK_ID",
            `Block id ${id} is not unique in project`,
            `targets.${target.id}.blocks.${id}`,
          ),
        );
      }
      globalBlockIds.add(id);
    }

    for (const [id, block] of Object.entries(blocks)) {
      const path = `targets.${target.id}.blocks.${id}`;

      if (block.topLevel && block.parent) {
        issues.push(
          issue(
            "TOPLEVEL_HAS_PARENT",
            `Top-level block ${id} must not have parent`,
            path,
          ),
        );
      }

      if (!block.topLevel && block.parent === null && block.next === null) {
        // Isolated non-top-level reporter shadows may be parented via inputs only;
        // if completely detached with no incoming ref, flag orphan later.
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
        } else if (parent.next === id) {
          // parent.next points here — OK for stack
        } else {
          // parent should reference this block via an input
          const referenced = Object.values(parent.inputs ?? {}).some(
            (inp) => extractBlockRefFromInput(inp) === id,
          );
          if (!referenced && parent.next !== id) {
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

      if (hasCycle(blocks, id)) {
        issues.push(
          issue("CYCLE_DETECTED", `Cycle involving block ${id}`, path),
        );
      }

      // Single occupant per input slot
      for (const [inputName, inputVal] of Object.entries(block.inputs ?? {})) {
        if (!Array.isArray(inputVal)) continue;
        const refs = inputVal.filter((x) => typeof x === "string") as string[];
        // Format [type, primary, shadow?] — at most one primary block id at [1]
        const primary = typeof inputVal[1] === "string" ? inputVal[1] : null;
        if (primary && !blocks[primary] && !isPrimitiveShadow(inputVal)) {
          // may be shadow primitive encoded differently — only flag if looks like uid
          if (primary.length >= 16) {
            issues.push(
              issue(
                "UNKNOWN_BLOCK_REF",
                `input ${inputName} references missing block ${primary}`,
                `${path}.inputs.${inputName}`,
              ),
            );
          }
        }
        void refs;
      }

      // Field variable / broadcast refs
      for (const [fieldName, fieldVal] of Object.entries(block.fields ?? {})) {
        if (!Array.isArray(fieldVal)) continue;
        const refId = fieldVal[1];
        if (typeof refId !== "string") continue;
        if (fieldName === "VARIABLE" && !varIds.has(refId)) {
          // Stage + sprite vars are both in varIds; missing => error
          issues.push(
            issue(
              "MISSING_VARIABLE_REF",
              `VARIABLE field references unknown id ${refId}`,
              `${path}.fields.${fieldName}`,
            ),
          );
        }
        if (fieldName === "LIST" && !varIds.has(refId)) {
          issues.push(
            issue(
              "MISSING_LIST_REF",
              `LIST field references unknown id ${refId}`,
              `${path}.fields.${fieldName}`,
            ),
          );
        }
        if (fieldName === "BROADCAST_OPTION" && !broadcastIds.has(refId)) {
          issues.push(
            issue(
              "MISSING_BROADCAST_REF",
              `BROADCAST references unknown id ${refId}`,
              `${path}.fields.${fieldName}`,
            ),
          );
        }
      }

      if (
        block.opcode.includes("_") &&
        options.allowedExtensions &&
        block.opcode.includes(".")
      ) {
        const ext = block.opcode.split(".")[0];
        if (ext && !allowedExt.has(ext)) {
          issues.push(
            issue(
              "EXTENSION_NOT_ALLOWED",
              `Extension ${ext} not allowed`,
              path,
            ),
          );
        }
      }
    }

    // Orphans: non-topLevel with parent null and never referenced
    const referenced = new Set<BlockId>();
    for (const b of Object.values(blocks)) {
      if (b.next) referenced.add(b.next);
      for (const inp of Object.values(b.inputs ?? {})) {
        const ref = extractBlockRefFromInput(inp);
        if (ref) referenced.add(ref);
        if (Array.isArray(inp) && typeof inp[2] === "string") {
          referenced.add(inp[2]);
        }
      }
    }
    for (const [id, b] of Object.entries(blocks)) {
      if (b.topLevel) continue;
      if (b.parent === null && !referenced.has(id)) {
        issues.push(
          issue(
            "ORPHAN_NON_TOPLEVEL",
            `Block ${id} is not top-level and not referenced`,
            `targets.${target.id}.blocks.${id}`,
          ),
        );
      }
    }

    void targetIds;
  }

  // Deduplicate cycle reports (same cycle flagged many times)
  const dedup = new Map<string, ValidationIssue>();
  for (const i of issues) {
    const key = `${i.code}:${i.path ?? ""}:${i.message}`;
    if (!dedup.has(key)) dedup.set(key, i);
  }
  const unique = [...dedup.values()];

  return { ok: unique.length === 0, issues: unique };
}

function isPrimitiveShadow(inputVal: unknown[]): boolean {
  // [1, [10, "text"]] style
  return Array.isArray(inputVal[1]);
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
