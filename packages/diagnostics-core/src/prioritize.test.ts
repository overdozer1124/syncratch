import {describe, expect, it} from "vitest";
import type {DiagnosticFinding} from "./contracts.js";
import {prioritizeFindings} from "./prioritize.js";

function finding(
  overrides: Partial<DiagnosticFinding> & Pick<DiagnosticFinding, "ruleId">,
): DiagnosticFinding {
  return {
    ruleId: overrides.ruleId,
    category: overrides.category ?? "test",
    severity: overrides.severity ?? "suggestion",
    confidence: overrides.confidence ?? "certain",
    targetIds: overrides.targetIds ?? ["t1"],
    blockIds: overrides.blockIds ?? [overrides.ruleId],
    evidence: overrides.evidence ?? [
      {kind: "t", blockIds: [overrides.ruleId]},
    ],
    hintId: overrides.hintId ?? "hint.test",
    ...(overrides.rootCauseGroup !== undefined
      ? {rootCauseGroup: overrides.rootCauseGroup}
      : {}),
  };
}

describe("prioritizeFindings", () => {
  it("limits primary findings to three", () => {
    const result = prioritizeFindings([
      finding({ruleId: "a"}),
      finding({ruleId: "b"}),
      finding({ruleId: "c"}),
      finding({ruleId: "d"}),
    ]);
    expect(result.primary.map(f => f.ruleId)).toEqual(["a", "b", "c"]);
    expect(result.secondary.map(f => f.ruleId)).toEqual(["d"]);
  });

  it("demotes later findings in the same rootCauseGroup", () => {
    const result = prioritizeFindings([
      finding({ruleId: "send", rootCauseGroup: "broadcast:id:1"}),
      finding({ruleId: "recv", rootCauseGroup: "broadcast:id:1"}),
      finding({ruleId: "other"}),
    ]);
    expect(result.primary.map(f => f.ruleId)).toEqual(["send", "other"]);
    expect(result.secondary.map(f => f.ruleId)).toEqual(["recv"]);
  });
});
