/**
 * Group execution-history entries by the script (hat / stack root) that
 * started them, so learners can review one hat at a time when several run.
 */

import {describeTraceSnapshot} from "./execution-trace-format.js";
import type {TraceEntry} from "./execution-trace-types.js";

/** Hat / script-start opcodes that open a Scratch stack. */
export const TRACE_HAT_OPCODES = new Set([
  "event_whenflagclicked",
  "event_whenkeypressed",
  "event_whenthisspriteclicked",
  "event_whenstageclicked",
  "event_whenbackdropswitchesto",
  "event_whengreaterthan",
  "event_whenbroadcastreceived",
  "control_start_as_clone",
  "procedures_definition",
]);

export function isTraceHatOpcode(opcode: string | null | undefined): boolean {
  return typeof opcode === "string" && TRACE_HAT_OPCODES.has(opcode);
}

/** Stable key for one script run source (sprite + top block). */
export function traceScriptKey(
  topBlockId: string | null | undefined,
  targetId: string | null | undefined,
): string {
  const top = typeof topBlockId === "string" && topBlockId ? topBlockId : "";
  const target = typeof targetId === "string" && targetId ? targetId : "";
  return `${target}\0${top}`;
}

export function entryScriptKey(entry: Pick<TraceEntry, "topBlockId" | "targetId" | "blockId">): string {
  // Prefer the recorded stack root; fall back so older/partial entries still group.
  const top =
    typeof entry.topBlockId === "string" && entry.topBlockId
      ? entry.topBlockId
      : entry.blockId;
  return traceScriptKey(top, entry.targetId);
}

export type TraceScriptOption = {
  key: string;
  topBlockId: string;
  targetId: string | null;
  targetName: string | null;
  /** Learner-facing label for the script switcher. */
  label: string;
  /** Latest entry time in this script (for auto-select). */
  lastTime: number;
  entryCount: number;
};

function truncateLabel(text: string, limit = 36): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1)}…`;
}

/**
 * Build switcher options from history entries (oldest→newest).
 * Order: most recently active script first (easier to pick the one just run).
 */
export function listTraceScripts(entries: TraceEntry[]): TraceScriptOption[] {
  const byKey = new Map<
    string,
    {
      option: TraceScriptOption;
      firstLabel: string;
    }
  >();

  for (const entry of entries) {
    const key = entryScriptKey(entry);
    const topBlockId =
      typeof entry.topBlockId === "string" && entry.topBlockId
        ? entry.topBlockId
        : entry.blockId;
    const existing = byKey.get(key);
    if (!existing) {
      const firstLabel = truncateLabel(describeTraceSnapshot(entry.snapshot));
      byKey.set(key, {
        firstLabel,
        option: {
          key,
          topBlockId,
          targetId: entry.targetId,
          targetName: entry.targetName,
          label: firstLabel,
          lastTime: entry.time,
          entryCount: 1,
        },
      });
    } else {
      existing.option.lastTime = Math.max(existing.option.lastTime, entry.time);
      existing.option.entryCount += 1;
      if (entry.targetName && !existing.option.targetName) {
        existing.option.targetName = entry.targetName;
      }
    }
  }

  const options = [...byKey.values()].map(({option, firstLabel}) => {
    option.label = firstLabel;
    return option;
  });

  // Disambiguate duplicate labels for learners.
  const labelCounts = new Map<string, number>();
  for (const option of options) {
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const option of options) {
    if ((labelCounts.get(option.label) ?? 0) <= 1) continue;
    const base = option.label;
    const withTarget = option.targetName ? `${base}（${option.targetName}）` : base;
    const n = (seen.get(withTarget) ?? 0) + 1;
    seen.set(withTarget, n);
    option.label = n === 1 ? withTarget : `${withTarget} ${n}`;
  }

  options.sort((a, b) => b.lastTime - a.lastTime);
  return options;
}

export function filterEntriesByScript(
  entries: TraceEntry[],
  scriptKey: string | null | undefined,
): TraceEntry[] {
  if (!scriptKey) return entries;
  return entries.filter(entry => entryScriptKey(entry) === scriptKey);
}

/** Prefer a still-valid selection; otherwise the most recently active script. */
export function resolveSelectedScriptKey(
  scripts: TraceScriptOption[],
  preferredKey: string | null | undefined,
): string | null {
  if (scripts.length === 0) return null;
  if (preferredKey && scripts.some(script => script.key === preferredKey)) {
    return preferredKey;
  }
  return scripts[0]?.key ?? null;
}
