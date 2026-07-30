/**
 * Structural diagnostic contracts (facts only — no learner-facing copy).
 */

export type DiagnosticConfidence = "certain" | "likely" | "possible";
export type DiagnosticSeverity = "integrity" | "warning" | "suggestion";

export interface DiagnosticEvidence {
  kind: string;
  targetId?: string;
  blockIds: string[];
  detail?: string;
}

export interface DiagnosticFinding {
  ruleId: string;
  category: string;
  severity: DiagnosticSeverity;
  confidence: DiagnosticConfidence;
  targetIds: string[];
  blockIds: string[];
  evidence: DiagnosticEvidence[];
  rootCauseGroup?: string;
  hintId: string;
}

export interface DiagnosticReport {
  schemaVersion: 1;
  findings: DiagnosticFinding[];
  limitations: string[];
  elapsedMs?: number;
}

const CONFIDENCE_RANK: Record<DiagnosticConfidence, number> = {
  certain: 0,
  likely: 1,
  possible: 2,
};

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  integrity: 0,
  warning: 1,
  suggestion: 2,
};

/** Stable key for duplicate suppression across equivalent findings. */
export function findingSuppressionKey(finding: DiagnosticFinding): string {
  const targets = [...finding.targetIds].sort().join(",");
  const blocks = [...finding.blockIds].sort().join(",");
  const evidence = finding.evidence
    .map(
      e =>
        `${e.kind}:${e.targetId ?? ""}:${[...e.blockIds].sort().join(",")}:${e.detail ?? ""}`,
    )
    .sort()
    .join("|");
  return [
    finding.ruleId,
    finding.category,
    finding.severity,
    finding.confidence,
    finding.hintId,
    finding.rootCauseGroup ?? "",
    targets,
    blocks,
    evidence,
  ].join("::");
}

function normalizeEvidence(evidence: DiagnosticEvidence[]): DiagnosticEvidence[] {
  return evidence.map(item => ({
    kind: item.kind,
    ...(item.targetId !== undefined ? {targetId: item.targetId} : {}),
    blockIds: [...item.blockIds],
    ...(item.detail !== undefined ? {detail: item.detail} : {}),
  }));
}

export function normalizeFinding(input: DiagnosticFinding): DiagnosticFinding {
  if (!input.ruleId) throw new Error("DiagnosticFinding.ruleId is required");
  if (!input.category) throw new Error("DiagnosticFinding.category is required");
  if (!input.hintId) throw new Error("DiagnosticFinding.hintId is required");
  if (!input.severity) throw new Error("DiagnosticFinding.severity is required");
  if (!input.confidence) {
    throw new Error("DiagnosticFinding.confidence is required");
  }
  return {
    ruleId: input.ruleId,
    category: input.category,
    severity: input.severity,
    confidence: input.confidence,
    targetIds: [...input.targetIds],
    blockIds: [...input.blockIds],
    evidence: normalizeEvidence(input.evidence ?? []),
    ...(input.rootCauseGroup !== undefined
      ? {rootCauseGroup: input.rootCauseGroup}
      : {}),
    hintId: input.hintId,
  };
}

/**
 * Deduplicate by suppression key, then order by severity → confidence →
 * ruleId → first blockId (deterministic).
 */
export function normalizeFindings(
  findings: readonly DiagnosticFinding[],
): DiagnosticFinding[] {
  const seen = new Set<string>();
  const unique: DiagnosticFinding[] = [];
  for (const raw of findings) {
    const finding = normalizeFinding(raw);
    const key = findingSuppressionKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    const conf = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (conf !== 0) return conf;
    const rule = a.ruleId.localeCompare(b.ruleId);
    if (rule !== 0) return rule;
    const blockA = a.blockIds[0] ?? "";
    const blockB = b.blockIds[0] ?? "";
    return blockA.localeCompare(blockB);
  });
}

export function createDiagnosticReport(
  findings: readonly DiagnosticFinding[],
  options: {limitations?: string[]; elapsedMs?: number} = {},
): DiagnosticReport {
  return {
    schemaVersion: 1,
    findings: normalizeFindings(findings),
    limitations: [...(options.limitations ?? [])],
    ...(options.elapsedMs !== undefined ? {elapsedMs: options.elapsedMs} : {}),
  };
}
