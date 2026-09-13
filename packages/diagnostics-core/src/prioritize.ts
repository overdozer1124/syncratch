import type {DiagnosticFinding} from "./contracts.js";

export interface PrioritizeOptions {
  /** Max primary findings shown initially. Default 3. */
  maxPrimary?: number;
}

export interface PrioritizedFindings {
  primary: DiagnosticFinding[];
  secondary: DiagnosticFinding[];
}

/**
 * Keep at most N primary findings. Findings that share a rootCauseGroup with a
 * primary finding are demoted to secondary (symptoms under a root cause).
 * Input is assumed already ordered by normalizeFindings.
 */
export function prioritizeFindings(
  findings: readonly DiagnosticFinding[],
  options: PrioritizeOptions = {},
): PrioritizedFindings {
  const maxPrimary = options.maxPrimary ?? 3;
  const primary: DiagnosticFinding[] = [];
  const secondary: DiagnosticFinding[] = [];
  const claimedGroups = new Set<string>();

  for (const finding of findings) {
    const group = finding.rootCauseGroup;
    if (group && claimedGroups.has(group)) {
      secondary.push(finding);
      continue;
    }
    if (primary.length < maxPrimary) {
      primary.push(finding);
      if (group) claimedGroups.add(group);
    } else {
      secondary.push(finding);
    }
  }

  return {primary, secondary};
}
