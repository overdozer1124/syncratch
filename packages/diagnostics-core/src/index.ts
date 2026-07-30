/**
 * @blocksync/diagnostics-core
 *
 * Browser-local standard diagnostics.
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

export {
  findingFromValidationIssue,
  schemaFindingsFromDocument,
} from "./schema-findings.js";

export {diagnoseProject} from "./diagnose.js";

export {
  DIAGNOSTIC_RULES,
  runRegisteredRules,
} from "./rules/registry.js";
export type {DiagnosticRule, DiagnosticRunOptions} from "./rules/types.js";

export {prioritizeFindings, type PrioritizeOptions, type PrioritizedFindings} from "./prioritize.js";

export {
  presentDiagnosticHints,
  type PresentedDiagnosticHints,
  type PresentedHint,
  type StagedHint,
} from "./hints/presenter.js";
export {
  GENERIC_DEBUG_ACTIONS,
  GENERIC_DEBUG_HINT_ID,
  lookupStagedHint,
} from "./hints/ja.js";
