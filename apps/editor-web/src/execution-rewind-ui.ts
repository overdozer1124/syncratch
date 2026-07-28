import type {RewindSnapshot} from "./execution-rewind-types.js";

export function formatRewindButtonTitle(
  snapshot: RewindSnapshot | null | undefined,
): string {
  if (!snapshot) return "1コマ戻る";

  if (snapshot.rewindError && !snapshot.canScrub) {
    if (snapshot.unsupportedOpcodes.length > 0) {
      return `${snapshot.rewindError} (${snapshot.unsupportedOpcodes.join(", ")})`;
    }
    return snapshot.rewindError;
  }

  if (snapshot.scrubDepthBack > 1) {
    return `1コマ戻る (${snapshot.scrubDepthBack}コマ)`;
  }
  return "1コマ戻る";
}

export function formatRewindButtonLabel(
  snapshot: RewindSnapshot | null | undefined,
): string {
  if (!snapshot || snapshot.scrubDepthBack <= 1) return "戻る";
  return `戻る (${snapshot.scrubDepthBack})`;
}

export function formatScrubSliderLabel(
  snapshot: RewindSnapshot | null | undefined,
): string {
  if (!snapshot || snapshot.recordFrontierFrameIndex < 0) return "0 / 0";
  return `${snapshot.playbackFrameIndex} / ${snapshot.recordFrontierFrameIndex}`;
}

export function formatScrubSliderAriaValueText(
  snapshot: RewindSnapshot | null | undefined,
): string {
  if (!snapshot || snapshot.recordFrontierFrameIndex < 0) {
    return "コマ 0 / 0";
  }
  return `コマ ${snapshot.playbackFrameIndex} / ${snapshot.recordFrontierFrameIndex}`;
}

export function shouldNotifyRewindUnavailable(
  previous: RewindSnapshot | null | undefined,
  next: RewindSnapshot | null | undefined,
): boolean {
  if (!previous || !next) return false;
  return previous.canScrub && !next.canScrub && Boolean(next.rewindError);
}

export function isExecutionControlShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  return true;
}

export type ExecutionControlShortcutAction =
  | "pause"
  | "rewind"
  | "step";

export function resolveExecutionControlShortcut(
  key: string,
  shiftKey: boolean,
): ExecutionControlShortcutAction | null {
  if (shiftKey) return null;
  if (key === " ") return "pause";
  if (key === "[") return "rewind";
  if (key === "]") return "step";
  return null;
}
