/**
 * Remember the last "Workspace Update Error" scratch-gui logged.
 *
 * `Blocks.onWorkspaceUpdate` catches every failure from
 * `clearWorkspaceAndLoadFromXml`, prefixes it with `Workspace Update Error:`,
 * logs it, and carries on — its own comment says this "lets the vm run even if
 * the workspace is incomplete" (containers/blocks.jsx). That is exactly the
 * shape of the reported bug: an empty-looking workspace over a VM that still
 * holds the scripts. When the run guard later notices the mismatch, the one
 * thing worth knowing is whether a workspace load had just failed — but by
 * then the error is gone from anywhere we can reach.
 *
 * scratch-gui logs through tslog, whose browser transport writes to
 * `console.log` rather than `console.error`, so both are wrapped. The wrappers
 * only read: they always forward to the original, and never throw.
 */

export type WorkspaceUpdateErrorRecord = {
  message: string;
  at: number;
};

/** Marker scratch-gui puts on the message before logging it. */
const MARKER = "Workspace Update Error";
const MAX_MESSAGE_LENGTH = 500;

let last: WorkspaceUpdateErrorRecord | null = null;
/** Guard double-wrapping per console, not process-wide: one stuck flag would
 * otherwise make every later install silently do nothing. */
const wrapped = new WeakSet<object>();

type ConsoleLike = {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    const message = (value as {message?: unknown}).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Pull the marked message out of one console call, or null when absent. */
export function extractWorkspaceUpdateError(args: unknown[]): string | null {
  for (const arg of args) {
    const text = textOf(arg);
    if (!text.includes(MARKER)) continue;
    const from = text.indexOf(MARKER);
    return text.slice(from, from + MAX_MESSAGE_LENGTH);
  }
  return null;
}

export function getLastWorkspaceUpdateError(): WorkspaceUpdateErrorRecord | null {
  return last ? {...last} : null;
}

/** Test seam; also used when a project load starts a fresh page of history. */
export function clearLastWorkspaceUpdateError(): void {
  last = null;
}

export function installWorkspaceUpdateErrorCapture(
  target: ConsoleLike | undefined = globalThis.console,
  now: () => number = Date.now,
): () => void {
  if (!target || wrapped.has(target)) return () => undefined;
  const originalLog = target.log;
  const originalError = target.error;

  const wrap = (
    original: ((...args: unknown[]) => void) | undefined,
  ): ((...args: unknown[]) => void) | undefined => {
    if (typeof original !== "function") return original;
    return (...args: unknown[]) => {
      try {
        const message = extractWorkspaceUpdateError(args);
        if (message) last = {message, at: now()};
      } catch {
        // A diagnostic must never break logging.
      }
      original.apply(target, args);
    };
  };

  target.log = wrap(originalLog);
  target.error = wrap(originalError);
  wrapped.add(target);

  return () => {
    target.log = originalLog;
    target.error = originalError;
    wrapped.delete(target);
  };
}
