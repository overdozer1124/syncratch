/**
 * Renders the execution trace as a chronological "what happened" list.
 */

import {describeTraceSnapshot} from "./execution-trace-format.js";
import type {ResolvedTraceEntry} from "./execution-trace.js";

export interface TraceLine {
  /** 1-based step number in execution order. */
  step: string;
  target: string;
  label: string;
}

/** Format a 1-based execution step index for the history list. */
export function formatTraceStep(stepIndex: number): string {
  const step = Math.max(1, Math.floor(stepIndex));
  return String(step);
}

export function formatTraceLine(
  entry: ResolvedTraceEntry,
  stepIndex: number,
): TraceLine {
  return {
    step: formatTraceStep(stepIndex),
    target: entry.targetName ?? "",
    label: describeTraceSnapshot(entry.snapshot),
  };
}

/** Oldest first — execution order. */
export function formatTraceLines(entries: ResolvedTraceEntry[]): TraceLine[] {
  return entries.map((entry, index) => formatTraceLine(entry, index + 1));
}

export interface TraceListView {
  render(entries: ResolvedTraceEntry[]): void;
}

const SCROLL_FOLLOW_THRESHOLD_PX = 48;

function shouldFollowScroll(container: HTMLElement): boolean {
  const distanceFromBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  return distanceFromBottom <= SCROLL_FOLLOW_THRESHOLD_PX;
}

/** Paint trace lines into `container` as a simple ordered list. */
export function createTraceListView(
  container: HTMLElement,
  documentRef: Document = container.ownerDocument,
): TraceListView {
  return {
    render(entries) {
      const follow = shouldFollowScroll(container);
      container.textContent = "";
      const lines = formatTraceLines(entries);
      if (lines.length === 0) {
        const empty = documentRef.createElement("p");
        empty.className = "trace-empty";
        empty.textContent = "まだ何も動いていません";
        container.appendChild(empty);
        return;
      }
      const list = documentRef.createElement("ol");
      list.className = "trace-list";
      for (const line of lines) {
        const item = documentRef.createElement("li");
        item.className = "trace-line";

        const step = documentRef.createElement("span");
        step.className = "trace-step";
        step.textContent = line.step;
        step.setAttribute("aria-label", `ステップ ${line.step}`);
        item.appendChild(step);

        if (line.target) {
          const target = documentRef.createElement("span");
          target.className = "trace-target";
          target.textContent = line.target;
          item.appendChild(target);
        }

        const label = documentRef.createElement("span");
        label.className = "trace-label";
        label.textContent = line.label;
        item.appendChild(label);

        list.appendChild(item);
      }
      container.appendChild(list);
      if (follow) {
        container.scrollTop = container.scrollHeight;
      }
    },
  };
}

/** @deprecated Use describeTraceSnapshot via formatTraceLine. */
export function describeOpcode(opcode: string | null): string {
  if (!opcode) return "（削除されたブロック）";
  return opcode;
}
