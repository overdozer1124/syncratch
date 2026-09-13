/**
 * Map validateProject() structural issues to integrity findings.
 * Learner-facing copy stays out of project-schema.
 */

import {
  validateProject,
  type ProjectDocument,
  type ValidateOptions,
  type ValidationIssue,
} from "@blocksync/project-schema";
import {
  normalizeFindings,
  type DiagnosticEvidence,
  type DiagnosticFinding,
} from "./contracts.js";

const PATH_TARGET = /^targets\.([^.]+)/;
const PATH_BLOCK = /^targets\.[^.]+\.blocks\.([^.]+)/;

function targetIdFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const m = PATH_TARGET.exec(path);
  return m?.[1];
}

function blockIdFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const m = PATH_BLOCK.exec(path);
  return m?.[1];
}

export function findingFromValidationIssue(
  issue: ValidationIssue,
): DiagnosticFinding {
  const targetId = targetIdFromPath(issue.path);
  const blockId = blockIdFromPath(issue.path);
  const blockIds = blockId ? [blockId] : [];
  const evidence: DiagnosticEvidence = {
    kind: "validation",
    ...(targetId !== undefined ? {targetId} : {}),
    blockIds,
    detail: `${issue.code}|${issue.path ?? ""}|${issue.message}`,
  };
  return {
    ruleId: `schema.${issue.code}`,
    category: "integrity",
    severity: "integrity",
    confidence: "certain",
    targetIds: targetId ? [targetId] : [],
    blockIds,
    evidence: [evidence],
    hintId: "hint.schema.integrity",
  };
}

/**
 * Convert schema validation issues into integrity findings.
 * Deduplicates by code/path/evidence via normalizeFindings.
 */
export function schemaFindingsFromDocument(
  document: ProjectDocument,
  options?: ValidateOptions,
): DiagnosticFinding[] {
  const result = validateProject(document, options);
  return normalizeFindings(result.issues.map(findingFromValidationIssue));
}
