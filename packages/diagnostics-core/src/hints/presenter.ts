import type {DiagnosticFinding, DiagnosticReport} from "../contracts.js";
import {
  GENERIC_DEBUG_ACTIONS,
  GENERIC_DEBUG_HINT_ID,
  lookupStagedHint,
} from "./ja.js";
import {prioritizeFindings, type PrioritizedFindings} from "../prioritize.js";

export interface StagedHint {
  hintId: string;
  stages: readonly [string, string?, string?];
  genericDebugActions: string[];
}

export interface PresentedHint {
  finding: DiagnosticFinding | null;
  hint: StagedHint;
  primary: boolean;
}

export interface PresentedDiagnosticHints {
  primary: PresentedHint[];
  secondary: PresentedHint[];
  /** True when no rule matched and the generic guide is shown. */
  usedGenericGuide: boolean;
}

function presentedFromFinding(
  finding: DiagnosticFinding,
  primary: boolean,
): PresentedHint {
  const hint =
    lookupStagedHint(finding.hintId) ??
    lookupStagedHint(GENERIC_DEBUG_HINT_ID)!;
  // Guard: never emit a full script in stage 1–2 (catalog is hand-authored).
  const stages = hint.stages;
  return {
    finding,
    hint: {
      hintId: hint.hintId,
      stages,
      genericDebugActions: hint.genericDebugActions,
    },
    primary,
  };
}

export function presentDiagnosticHints(
  report: DiagnosticReport,
  options?: {maxPrimary?: number},
): PresentedDiagnosticHints {
  const prioritized: PrioritizedFindings = prioritizeFindings(report.findings, {
    maxPrimary: options?.maxPrimary,
  });

  if (prioritized.primary.length === 0) {
    const generic = lookupStagedHint(GENERIC_DEBUG_HINT_ID)!;
    return {
      primary: [
        {
          finding: null,
          hint: {
            hintId: generic.hintId,
            stages: generic.stages,
            genericDebugActions: [...GENERIC_DEBUG_ACTIONS],
          },
          primary: true,
        },
      ],
      secondary: [],
      usedGenericGuide: true,
    };
  }

  return {
    primary: prioritized.primary.map(f => presentedFromFinding(f, true)),
    secondary: prioritized.secondary.map(f => presentedFromFinding(f, false)),
    usedGenericGuide: false,
  };
}
