import {describe, expect, it} from "vitest";
import {createDiagnosticReport, type DiagnosticFinding} from "../contracts.js";
import {diagnoseProject} from "../diagnose.js";
import {
  emptyForeverBody,
  normalGreenFlagMove,
} from "../testing/project-fixtures.js";
import {presentDiagnosticHints} from "./presenter.js";

function finding(
  overrides: Partial<DiagnosticFinding> &
    Pick<DiagnosticFinding, "ruleId" | "hintId">,
): DiagnosticFinding {
  return {
    ruleId: overrides.ruleId,
    category: overrides.category ?? "structure",
    severity: overrides.severity ?? "suggestion",
    confidence: overrides.confidence ?? "certain",
    targetIds: overrides.targetIds ?? ["s1"],
    blockIds: overrides.blockIds ?? ["b1"],
    evidence: overrides.evidence ?? [{kind: "t", blockIds: ["b1"]}],
    hintId: overrides.hintId,
    ...(overrides.rootCauseGroup !== undefined
      ? {rootCauseGroup: overrides.rootCauseGroup}
      : {}),
  };
}

describe("presentDiagnosticHints", () => {
  it("returns generic debug guide when no findings", () => {
    const report = diagnoseProject(normalGreenFlagMove());
    const presented = presentDiagnosticHints(report);
    expect(presented.usedGenericGuide).toBe(true);
    expect(presented.primary[0]?.hint.hintId).toBe("hint.generic-debug");
    expect(
      presented.primary[0]?.hint.genericDebugActions.length,
    ).toBeGreaterThan(0);
  });

  it("maps empty-c-block to staged Japanese hints without full scripts", () => {
    const report = diagnoseProject(emptyForeverBody(), {
      includeSchemaFindings: false,
    });
    const presented = presentDiagnosticHints(report);
    expect(presented.usedGenericGuide).toBe(false);
    const hint = presented.primary.find(
      p => p.hint.hintId === "hint.empty-c-block",
    )?.hint;
    expect(hint?.stages[0]).toBeTruthy();
    const joined = hint?.stages.filter(Boolean).join("\n") ?? "";
    expect(joined).not.toMatch(/event_whenflagclicked[\s\S]*motion_movesteps/);
  });

  it("groups compound findings so primary hints do not contradict", () => {
    const presented = presentDiagnosticHints(
      createDiagnosticReport([
        finding({
          ruleId: "broadcast.send-without-receive",
          hintId: "hint.broadcast.send-without-receive",
          severity: "warning",
          rootCauseGroup: "broadcast:id:x",
          blockIds: ["send"],
        }),
        finding({
          ruleId: "broadcast.receive-without-send",
          hintId: "hint.broadcast.receive-without-send",
          confidence: "likely",
          rootCauseGroup: "broadcast:id:x",
          blockIds: ["recv"],
        }),
      ]),
    );
    expect(presented.primary).toHaveLength(1);
    expect(presented.secondary).toHaveLength(1);
    expect(presented.primary[0]?.hint.hintId).toBe(
      "hint.broadcast.send-without-receive",
    );
    expect(presented.secondary[0]?.hint.hintId).toBe(
      "hint.broadcast.receive-without-send",
    );
  });
});
