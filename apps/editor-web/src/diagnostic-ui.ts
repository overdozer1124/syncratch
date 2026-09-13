/**
 * DOM-oriented helpers for the standard diagnostics panel.
 * Pure enough to unit-test without the Scratch VM.
 */

import type {DiagnosticViewModel} from "./diagnostic-controller.js";

export interface DiagnosticUiBindings {
  runButton: HTMLButtonElement;
  statusEl: HTMLElement;
  resultsEl: HTMLElement;
  feedbackEl: HTMLElement;
}

export function diagnosticRunButtonLabel(
  status: DiagnosticViewModel["status"],
): string {
  return status === "running" ? "確認中…" : "ヒントを見る";
}

export function renderDiagnosticView(
  bindings: DiagnosticUiBindings,
  view: DiagnosticViewModel,
  options?: {
    onReveal?: (findingId: string) => void;
  },
): void {
  bindings.runButton.textContent = diagnosticRunButtonLabel(view.status);
  bindings.runButton.disabled = view.status === "running";

  if (view.status === "idle") {
    bindings.statusEl.textContent = "";
    bindings.resultsEl.replaceChildren();
    bindings.feedbackEl.textContent =
      "作品をこの端末だけで確認して、ヒントを少しずつ表示します。";
    return;
  }

  if (view.status === "running") {
    bindings.statusEl.textContent = "この端末で確認しています…";
    bindings.resultsEl.replaceChildren();
    bindings.feedbackEl.textContent = "";
    return;
  }

  if (view.status === "unavailable") {
    bindings.statusEl.textContent = "";
    bindings.resultsEl.replaceChildren();
    bindings.feedbackEl.textContent =
      view.unavailableMessage ?? "ヒントを確認できませんでした。";
    return;
  }

  // ready
  bindings.statusEl.textContent = view.processingLabel;
  bindings.feedbackEl.textContent = view.usedGenericGuide
    ? "はっきりした問題は見つかりませんでした。下の手順を試してみましょう。"
    : "";

  bindings.resultsEl.replaceChildren();
  for (const finding of view.findings) {
    const card = document.createElement("article");
    card.className = finding.primary
      ? "diagnostic-finding diagnostic-finding--primary"
      : "diagnostic-finding diagnostic-finding--secondary";
    card.dataset.findingId = finding.id;
    card.dataset.testid = "diagnostic-finding";
    if (finding.integrity) {
      card.classList.add("diagnostic-finding--integrity");
    }

    const stages = document.createElement("div");
    stages.className = "diagnostic-finding-stages";
    stages.setAttribute("aria-live", "polite");
    for (let i = 0; i < finding.revealedStages; i++) {
      const p = document.createElement("p");
      p.className = "diagnostic-stage";
      p.textContent = finding.stages[i] ?? "";
      stages.append(p);
    }
    card.append(stages);

    if (finding.revealedStages < finding.stages.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "button-secondary diagnostic-reveal";
      more.dataset.testid = "diagnostic-reveal";
      more.textContent = "もう少しヒント";
      more.addEventListener("click", () => {
        options?.onReveal?.(finding.id);
      });
      card.append(more);
    }

    bindings.resultsEl.append(card);
  }

  if (view.usedGenericGuide && view.genericActions.length > 0) {
    const list = document.createElement("ol");
    list.className = "diagnostic-generic-actions";
    list.dataset.testid = "diagnostic-generic-actions";
    for (const action of view.genericActions) {
      const li = document.createElement("li");
      li.textContent = action;
      list.append(li);
    }
    bindings.resultsEl.append(list);
  }
}
