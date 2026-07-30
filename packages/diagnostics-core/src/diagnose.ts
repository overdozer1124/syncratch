import type {ProjectDocument} from "@blocksync/project-schema";
import {
  createDiagnosticReport,
  normalizeFindings,
  type DiagnosticReport,
} from "./contracts.js";
import {buildDiagnosticProjectIR} from "./ir.js";
import {runRegisteredRules} from "./rules/registry.js";
import type {DiagnosticRunOptions} from "./rules/types.js";
import {schemaFindingsFromDocument} from "./schema-findings.js";

const BASE_LIMITATIONS = [
  "static-graph-only",
  "no-runtime-execution",
  "no-external-ai",
] as const;

/**
 * Standard diagnostics entry point.
 * Schema integrity + registered semantic rules. No network / Transformers.js.
 */
export function diagnoseProject(
  document: ProjectDocument,
  options: DiagnosticRunOptions = {},
): DiagnosticReport {
  const started = Date.now();
  const includeSchema = options.includeSchemaFindings !== false;
  const schemaFindings = includeSchema
    ? schemaFindingsFromDocument(document, options.validateOptions)
    : [];
  const ir = buildDiagnosticProjectIR(document);
  const ruleFindings = runRegisteredRules(ir);
  const findings = normalizeFindings([...schemaFindings, ...ruleFindings]);
  return createDiagnosticReport(findings, {
    limitations: [...BASE_LIMITATIONS],
    elapsedMs: Date.now() - started,
  });
}
