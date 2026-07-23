/**
 * Spec §31 Block IR proposal types.
 * Prototype: define the contract; apply/mutation pipeline comes later.
 * Model-generated block IDs must not be trusted — Mutation API assigns IDs.
 */

export type BlockIROperationType =
  | "create_script"
  | "insert_block"
  | "replace_block"
  | "move_block"
  | "delete_block"
  | "update_input"
  | "create_variable"
  | "create_list"
  | "create_broadcast"
  | "propose_extension";

export interface BlockIROperation {
  type: BlockIROperationType;
  /** Opaque payload validated by a later Mutation API — not applied here. */
  payload: Record<string, unknown>;
}

export interface BlockIRProposal {
  irVersion: number;
  projectId: string;
  baseRevision: number;
  targetId: string;
  intentSummary: string;
  operations: BlockIROperation[];
  assumptions: string[];
  requiredExtensions: string[];
  compatibilityImpact: string[];
}

export const BLOCK_IR_VERSION = 1;

export function createEmptyBlockIRProposal(
  partial: Pick<
    BlockIRProposal,
    "projectId" | "baseRevision" | "targetId" | "intentSummary"
  >,
): BlockIRProposal {
  return {
    irVersion: BLOCK_IR_VERSION,
    projectId: partial.projectId,
    baseRevision: partial.baseRevision,
    targetId: partial.targetId,
    intentSummary: partial.intentSummary,
    operations: [],
    assumptions: [],
    requiredExtensions: [],
    compatibilityImpact: [],
  };
}

/**
 * Spec §33: whether explicit user approval is required before any future apply.
 */
export function requiresExplicitApproval(proposal: BlockIRProposal): boolean {
  if (proposal.operations.some(op => op.type === "delete_block")) return true;
  if (proposal.requiredExtensions.length > 0) return true;
  if (proposal.compatibilityImpact.length > 0) return true;
  const targetHints = new Set<string>();
  for (const op of proposal.operations) {
    const tid = op.payload.targetId;
    if (typeof tid === "string" && tid) targetHints.add(tid);
  }
  if (targetHints.size > 1) return true;
  return proposal.operations.length === 0 ? false : false;
}
