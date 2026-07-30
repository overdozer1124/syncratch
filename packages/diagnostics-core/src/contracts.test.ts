import {describe, expect, it} from "vitest";
import {
  createDiagnosticReport,
  findingSuppressionKey,
  normalizeFinding,
  normalizeFindings,
  type DiagnosticFinding,
} from "./contracts.js";

function finding(
  overrides: Partial<DiagnosticFinding> & Pick<DiagnosticFinding, "ruleId">,
): DiagnosticFinding {
  return {
    ruleId: overrides.ruleId,
    category: overrides.category ?? "test",
    severity: overrides.severity ?? "suggestion",
    confidence: overrides.confidence ?? "certain",
    targetIds: overrides.targetIds ?? ["t1"],
    blockIds: overrides.blockIds ?? ["b1"],
    evidence: overrides.evidence ?? [
      {kind: "block", blockIds: overrides.blockIds ?? ["b1"]},
    ],
    hintId: overrides.hintId ?? "hint.test",
    ...(overrides.rootCauseGroup !== undefined
      ? {rootCauseGroup: overrides.rootCauseGroup}
      : {}),
  };
}

describe("normalizeFinding", () => {
  it("requires structural fields", () => {
    expect(() =>
      normalizeFinding({
        ruleId: "",
        category: "c",
        severity: "warning",
        confidence: "likely",
        targetIds: [],
        blockIds: [],
        evidence: [],
        hintId: "h",
      }),
    ).toThrow(/ruleId/);
  });

  it("copies arrays so callers cannot mutate the normalized finding", () => {
    const blockIds = ["b2", "b1"];
    const normalized = normalizeFinding(finding({ruleId: "r1", blockIds}));
    blockIds.push("b3");
    expect(normalized.blockIds).toEqual(["b2", "b1"]);
  });
});

describe("normalizeFindings", () => {
  it("suppresses duplicates by stable key", () => {
    const a = finding({ruleId: "r1", blockIds: ["b1"]});
    const b = finding({ruleId: "r1", blockIds: ["b1"]});
    expect(findingSuppressionKey(a)).toBe(findingSuppressionKey(b));
    expect(normalizeFindings([a, b])).toHaveLength(1);
  });

  it("orders by severity then confidence then ruleId", () => {
    const ordered = normalizeFindings([
      finding({
        ruleId: "z",
        severity: "suggestion",
        confidence: "possible",
        blockIds: ["b9"],
      }),
      finding({
        ruleId: "a",
        severity: "integrity",
        confidence: "certain",
        blockIds: ["b1"],
      }),
      finding({
        ruleId: "m",
        severity: "warning",
        confidence: "likely",
        blockIds: ["b2"],
      }),
    ]);
    expect(ordered.map(f => f.ruleId)).toEqual(["a", "m", "z"]);
  });
});

describe("createDiagnosticReport", () => {
  it("always uses schemaVersion 1", () => {
    const report = createDiagnosticReport([finding({ruleId: "r1"})], {
      limitations: ["no runtime execution"],
      elapsedMs: 12,
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.findings).toHaveLength(1);
    expect(report.limitations).toEqual(["no runtime execution"]);
    expect(report.elapsedMs).toBe(12);
  });
});
