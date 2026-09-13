/**
 * Empty event script rule: hat with no following stack.
 *
 * False-positive note: A hat left as a bookmark / future work still reports.
 * We only observe the static graph (nextId == null), not learner intent.
 */

import type {DiagnosticFinding} from "../contracts.js";
import type {DiagnosticProjectIR} from "../ir.js";
import type {DiagnosticRule} from "./types.js";

/** Stack (non-hat) blocks that share the `event_` opcode prefix. */
const EVENT_NON_HAT = new Set([
  "event_broadcast",
  "event_broadcastandwait",
]);

function isEventHat(opcode: string): boolean {
  return opcode.startsWith("event_") && !EVENT_NON_HAT.has(opcode);
}

export const emptyEventScriptRule: DiagnosticRule = {
  id: "empty-event-script",
  run(ir: DiagnosticProjectIR): DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];
    for (const target of ir.targets) {
      for (const block of target.blocksById.values()) {
        if (block.shadow) continue;
        if (!isEventHat(block.opcode)) continue;
        if (block.nextId != null) continue;

        findings.push({
          ruleId: "empty-event-script",
          category: "structure",
          severity: "suggestion",
          confidence: "certain",
          targetIds: [target.id],
          blockIds: [block.id],
          evidence: [
            {
              kind: "empty-script",
              targetId: target.id,
              blockIds: [block.id],
              detail: block.opcode,
            },
          ],
          hintId: "hint.empty-event-script",
        });
      }
    }
    return findings;
  },
};
