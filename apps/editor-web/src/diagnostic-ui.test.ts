/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import type {DiagnosticViewModel} from "./diagnostic-controller.js";
import {
  diagnosticRunButtonLabel,
  renderDiagnosticView,
} from "./diagnostic-ui.js";

function bindings() {
  return {
    runButton: document.createElement("button"),
    statusEl: document.createElement("div"),
    resultsEl: document.createElement("div"),
    feedbackEl: document.createElement("div"),
  };
}

describe("diagnostic-ui", () => {
  it("labels the primary action ヒントを見る", () => {
    expect(diagnosticRunButtonLabel("idle")).toBe("ヒントを見る");
    expect(diagnosticRunButtonLabel("running")).toBe("確認中…");
  });

  it("renders processing label and staged reveal control", () => {
    const b = bindings();
    const view: DiagnosticViewModel = {
      status: "ready",
      processingLabel: "この端末で確認しました",
      findings: [
        {
          id: "f1",
          ruleId: "empty-c-block",
          severity: "suggestion",
          confidence: "certain",
          hintId: "hint.empty-c-block",
          stages: ["一歩め", "二歩め"],
          revealedStages: 1,
          primary: true,
          integrity: false,
        },
      ],
      usedGenericGuide: false,
      genericActions: [],
      runId: 1,
    };
    let revealed: string | null = null;
    renderDiagnosticView(b, view, {
      onReveal: id => {
        revealed = id;
      },
    });
    expect(b.statusEl.textContent).toBe("この端末で確認しました");
    expect(b.resultsEl.querySelectorAll(".diagnostic-stage")).toHaveLength(1);
    const btn = b.resultsEl.querySelector(
      "[data-testid='diagnostic-reveal']",
    ) as HTMLButtonElement;
    btn.click();
    expect(revealed).toBe("f1");
  });

  it("renders unavailable message", () => {
    const b = bindings();
    renderDiagnosticView(b, {
      status: "unavailable",
      processingLabel: "この端末で確認しました",
      unavailableMessage: "読めません",
      findings: [],
      usedGenericGuide: false,
      genericActions: [],
      runId: 2,
    });
    expect(b.feedbackEl.textContent).toBe("読めません");
  });
});
