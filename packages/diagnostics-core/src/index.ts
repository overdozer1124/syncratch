/**
 * @blocksync/diagnostics-core
 *
 * Browser-local standard diagnostics (facts / IR only in Phase 1).
 * No network, DOM, fetch, or Transformers.js.
 */

export {
  createDiagnosticReport,
  findingSuppressionKey,
  normalizeFinding,
  normalizeFindings,
  type DiagnosticConfidence,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticReport,
  type DiagnosticSeverity,
} from "./contracts.js";

export {
  buildDiagnosticProjectIR,
  inputOccupantBlockId,
  normalizeDiagnosticField,
  normalizeDiagnosticInput,
  walkDiagnosticStack,
  type DiagnosticBlockIR,
  type DiagnosticBroadcastIR,
  type DiagnosticFieldIR,
  type DiagnosticInputIR,
  type DiagnosticListIR,
  type DiagnosticProjectIR,
  type DiagnosticTargetIR,
  type DiagnosticVariableIR,
} from "./ir.js";
