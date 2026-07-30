import type {DiagnosticFinding} from "../contracts.js";
import type {DiagnosticProjectIR} from "../ir.js";
import {
  broadcastReceiveWithoutSendRule,
  broadcastSendWithoutReceiveRule,
} from "./broadcast-flow.js";
import {emptyCBlockRule} from "./empty-c-block.js";
import {emptyEventScriptRule} from "./empty-event-script.js";
import type {DiagnosticRule} from "./types.js";

/** Stable registry order — do not reorder casually (affects finding sort ties). */
export const DIAGNOSTIC_RULES: readonly DiagnosticRule[] = [
  emptyCBlockRule,
  broadcastSendWithoutReceiveRule,
  broadcastReceiveWithoutSendRule,
  emptyEventScriptRule,
];

export function runRegisteredRules(
  ir: DiagnosticProjectIR,
  rules: readonly DiagnosticRule[] = DIAGNOSTIC_RULES,
): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = [];
  for (const rule of rules) {
    out.push(...rule.run(ir));
  }
  return out;
}
