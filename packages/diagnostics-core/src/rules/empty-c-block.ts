/**
 * Empty C-block body rule.
 *
 * False-positive note: A forever/repeat/if with an intentionally empty body
 * (e.g. placeholder) still reports. Teachers may suppress via later catalog
 * flags; we do not guess intent here.
 */

import type {DiagnosticFinding} from "../contracts.js";
import {
  inputOccupantBlockId,
  type DiagnosticBlockIR,
  type DiagnosticProjectIR,
} from "../ir.js";
import type {DiagnosticRule} from "./types.js";

const C_BLOCK_OPCODES = new Set([
  "control_forever",
  "control_repeat",
  "control_repeat_until",
  "control_if",
  "control_if_else",
]);

function emptySubstack(block: DiagnosticBlockIR, slot: string): boolean {
  const input = block.inputs.get(slot);
  if (!input) {
    // Missing SUBSTACK key on a C-block is treated as empty body.
    return true;
  }
  if (input.empty) return true;
  return inputOccupantBlockId(input) == null && input.inlinePrimitive == null;
}

export const emptyCBlockRule: DiagnosticRule = {
  id: "empty-c-block",
  run(ir: DiagnosticProjectIR): DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];
    for (const target of ir.targets) {
      for (const block of target.blocksById.values()) {
        if (block.shadow) continue;
        if (!C_BLOCK_OPCODES.has(block.opcode)) continue;

        const emptyPrimary = emptySubstack(block, "SUBSTACK");
        const emptyElse =
          block.opcode === "control_if_else"
            ? emptySubstack(block, "SUBSTACK2")
            : false;

        if (!emptyPrimary && !emptyElse) continue;

        const slots: string[] = [];
        if (emptyPrimary) slots.push("SUBSTACK");
        if (emptyElse) slots.push("SUBSTACK2");

        findings.push({
          ruleId: "empty-c-block",
          category: "structure",
          severity: "suggestion",
          confidence: "certain",
          targetIds: [target.id],
          blockIds: [block.id],
          evidence: [
            {
              kind: "empty-substack",
              targetId: target.id,
              blockIds: [block.id],
              detail: `${block.opcode}:${slots.join(",")}`,
            },
          ],
          hintId: "hint.empty-c-block",
        });
      }
    }
    return findings;
  },
};
