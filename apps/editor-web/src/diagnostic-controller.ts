/**
 * Standard diagnostics controller (independent of AiAssistSettings).
 */

import {
  diagnoseProject,
  findingSuppressionKey,
  presentDiagnosticHints,
  type DiagnosticFinding,
  type DiagnosticReport,
  type PresentedDiagnosticHints,
} from "@blocksync/diagnostics-core";
import type {ProjectDocument} from "@blocksync/project-schema";
import type {LiveSnapshotResult} from "./live-project-snapshot.js";
import {liveSnapshotUnavailableMessage} from "./live-project-snapshot.js";

export type DiagnosticViewStatus =
  | "idle"
  | "running"
  | "ready"
  | "unavailable";

export interface DiagnosticFindingView {
  id: string;
  ruleId: string;
  severity: DiagnosticFinding["severity"];
  confidence: DiagnosticFinding["confidence"];
  hintId: string;
  stages: string[];
  /** Number of stages currently revealed (1..stages.length). */
  revealedStages: number;
  primary: boolean;
  integrity: boolean;
}

export interface DiagnosticViewModel {
  status: DiagnosticViewStatus;
  processingLabel: string;
  unavailableMessage?: string;
  findings: DiagnosticFindingView[];
  usedGenericGuide: boolean;
  genericActions: string[];
  runId: number;
}

export interface DiagnosticController {
  run(): Promise<DiagnosticViewModel>;
  revealNextHint(findingId: string): DiagnosticViewModel;
  reset(): void;
  getViewModel(): DiagnosticViewModel;
}

export interface DiagnosticControllerDeps {
  captureSnapshot: () => LiveSnapshotResult;
  diagnose?: (document: ProjectDocument) => DiagnosticReport;
  present?: (report: DiagnosticReport) => PresentedDiagnosticHints;
}

const PROCESSING_LABEL = "この端末で確認しました";

function idleView(runId: number): DiagnosticViewModel {
  return {
    status: "idle",
    processingLabel: PROCESSING_LABEL,
    findings: [],
    usedGenericGuide: false,
    genericActions: [],
    runId,
  };
}

function findingView(
  finding: DiagnosticFinding,
  stages: string[],
  primary: boolean,
  revealedStages = 1,
): DiagnosticFindingView {
  return {
    id: findingSuppressionKey(finding),
    ruleId: finding.ruleId,
    severity: finding.severity,
    confidence: finding.confidence,
    hintId: finding.hintId,
    stages,
    revealedStages: Math.min(Math.max(revealedStages, 1), stages.length || 1),
    primary,
    integrity: finding.severity === "integrity",
  };
}

export function createDiagnosticController(
  deps: DiagnosticControllerDeps,
): DiagnosticController {
  let runId = 0;
  let view = idleView(0);
  const diagnose = deps.diagnose ?? diagnoseProject;
  const present = deps.present ?? presentDiagnosticHints;

  return {
    async run(): Promise<DiagnosticViewModel> {
      const thisRun = ++runId;
      view = {
        ...idleView(thisRun),
        status: "running",
      };
      // Yield so the UI can paint the running state before sync work.
      await Promise.resolve();
      if (thisRun !== runId) return view;

      const snapshot = deps.captureSnapshot();
      if (thisRun !== runId) return view;
      if (!snapshot.ok) {
        view = {
          status: "unavailable",
          processingLabel: PROCESSING_LABEL,
          unavailableMessage:
            snapshot.message ||
            liveSnapshotUnavailableMessage(snapshot.reason),
          findings: [],
          usedGenericGuide: false,
          genericActions: [],
          runId: thisRun,
        };
        return view;
      }

      const report = diagnose(snapshot.snapshot.document);
      if (thisRun !== runId) return view;
      const presented = present(report);

      if (presented.usedGenericGuide) {
        const hint = presented.primary[0]?.hint;
        view = {
          status: "ready",
          processingLabel: PROCESSING_LABEL,
          findings: [],
          usedGenericGuide: true,
          genericActions: hint?.genericDebugActions ?? [],
          runId: thisRun,
        };
        // Surface generic stages as a synthetic finding-less guide via genericActions
        // plus a single virtual card for stage reveal.
        if (hint) {
          view.findings = [
            {
              id: "generic-debug",
              ruleId: "generic-debug",
              severity: "suggestion",
              confidence: "possible",
              hintId: hint.hintId,
              stages: hint.stages.filter((s): s is string => Boolean(s)),
              revealedStages: 1,
              primary: true,
              integrity: false,
            },
          ];
        }
        return view;
      }

      const findings: DiagnosticFindingView[] = [];
      for (const item of presented.primary) {
        if (!item.finding) continue;
        const stages = item.hint.stages.filter((s): s is string => Boolean(s));
        findings.push(findingView(item.finding, stages, true, 1));
      }
      for (const item of presented.secondary) {
        if (!item.finding) continue;
        const stages = item.hint.stages.filter((s): s is string => Boolean(s));
        findings.push(findingView(item.finding, stages, false, 1));
      }

      view = {
        status: "ready",
        processingLabel: PROCESSING_LABEL,
        findings,
        usedGenericGuide: false,
        genericActions: presented.primary[0]?.hint.genericDebugActions ?? [],
        runId: thisRun,
      };
      return view;
    },

    revealNextHint(findingId: string): DiagnosticViewModel {
      const nextFindings = view.findings.map(f => {
        if (f.id !== findingId) return f;
        if (f.revealedStages >= f.stages.length) return f;
        return {...f, revealedStages: f.revealedStages + 1};
      });
      view = {...view, findings: nextFindings};
      return view;
    },

    reset(): void {
      runId += 1;
      view = idleView(runId);
    },

    getViewModel(): DiagnosticViewModel {
      return view;
    },
  };
}
