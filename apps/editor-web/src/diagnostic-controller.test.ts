import {describe, expect, it} from "vitest";
import {
  createDiagnosticReport,
  type DiagnosticFinding,
} from "@blocksync/diagnostics-core";
import {createDiagnosticController} from "./diagnostic-controller.js";

function finding(ruleId: string, hintId: string): DiagnosticFinding {
  return {
    ruleId,
    category: "structure",
    severity: "suggestion",
    confidence: "certain",
    targetIds: ["s1"],
    blockIds: ["b1"],
    evidence: [{kind: "t", blockIds: ["b1"]}],
    hintId,
  };
}

describe("createDiagnosticController", () => {
  it("is independent of AI settings and reports processing label", async () => {
    const controller = createDiagnosticController({
      captureSnapshot: () => ({
        ok: true,
        snapshot: {
          document: {schemaVersion: 1, targets: []},
          rawProjectJson: {},
        },
      }),
      diagnose: () =>
        createDiagnosticReport([
          finding("empty-c-block", "hint.empty-c-block"),
        ]),
      present: report => ({
        primary: [
          {
            finding: report.findings[0]!,
            hint: {
              hintId: "hint.empty-c-block",
              stages: ["段階1", "段階2", "段階3"],
              genericDebugActions: ["a"],
            },
            primary: true,
          },
        ],
        secondary: [],
        usedGenericGuide: false,
      }),
    });

    const view = await controller.run();
    expect(view.status).toBe("ready");
    expect(view.processingLabel).toBe("この端末で確認しました");
    expect(view.findings[0]?.revealedStages).toBe(1);

    const next = controller.revealNextHint(view.findings[0]!.id);
    expect(next.findings[0]?.revealedStages).toBe(2);
  });

  it("returns unavailable view when snapshot fails", async () => {
    const controller = createDiagnosticController({
      captureSnapshot: () => ({
        ok: false,
        reason: "no-vm",
        message: "作品がまだ読み込まれていないため、ヒントを確認できません。",
      }),
    });
    const view = await controller.run();
    expect(view.status).toBe("unavailable");
    expect(view.unavailableMessage).toContain("読み込まれてい");
  });

  it("protects against stale runs via reset", async () => {
    const controller = createDiagnosticController({
      captureSnapshot: () => ({
        ok: true,
        snapshot: {
          document: {schemaVersion: 1, targets: []},
          rawProjectJson: {},
        },
      }),
      diagnose: () =>
        createDiagnosticReport([finding("r1", "hint.empty-c-block")]),
      present: report => ({
        primary: [
          {
            finding: report.findings[0]!,
            hint: {
              hintId: "hint.empty-c-block",
              stages: ["a"],
              genericDebugActions: [],
            },
            primary: true,
          },
        ],
        secondary: [],
        usedGenericGuide: false,
      }),
    });
    const pending = controller.run();
    controller.reset();
    await pending;
    expect(controller.getViewModel().status).toBe("idle");
  });

  it("surfaces a generic guide when no rules match", async () => {
    const controller = createDiagnosticController({
      captureSnapshot: () => ({
        ok: true,
        snapshot: {
          document: {schemaVersion: 1, targets: []},
          rawProjectJson: {},
        },
      }),
      diagnose: () => createDiagnosticReport([]),
      present: () => ({
        primary: [
          {
            finding: null,
            hint: {
              hintId: "hint.generic-debug",
              stages: ["g1", "g2"],
              genericDebugActions: ["x"],
            },
            primary: true,
          },
        ],
        secondary: [],
        usedGenericGuide: true,
      }),
    });
    const view = await controller.run();
    expect(view.usedGenericGuide).toBe(true);
    expect(view.findings[0]?.hintId).toBe("hint.generic-debug");
  });
});
