import type {JournalEntryKind} from "./execution-rewind-types.js";
import type {RewindOrigin} from "./execution-rewind-types.js";

/** Journal kinds that are captured during record/replay. */
export const IMPLEMENTED_JOURNAL_KINDS = new Set<JournalEntryKind>([
  "random",
  "clock",
  "mouse",
  "key",
  "cloneOrder",
  "loudness",
  "askAnswer",
  "videoSensing",
  "extensionReporter",
  "broadcastOrder",
  "promiseResolve",
]);

/** Explicit opcode → journal kind mapping for unjournaled non-deterministic inputs. */
export const OPCODE_JOURNAL_KIND = new Map<string, JournalEntryKind>([
  ["operator_random", "random"],
  ["sensing_askandwait", "promiseResolve"],
  ["sensing_answer", "askAnswer"],
  ["sensing_loudness", "loudness"],
  ["sensing_loud", "loudness"],
  ["sensing_videoon", "videoSensing"],
  ["sensing_videotoggle", "videoSensing"],
  ["sensing_setvideotransparency", "videoSensing"],
  ["sensing_videomotion", "videoSensing"],
  ["sensing_current", "extensionReporter"],
  ["sensing_dayssince2000", "extensionReporter"],
  ["sensing_online", "extensionReporter"],
  ["sensing_username", "extensionReporter"],
  ["event_broadcastandwait", "broadcastOrder"],
  ["looks_switchbackdroptoandwait", "broadcastOrder"],
  ["looks_sayforsecs", "promiseResolve"],
  ["looks_thinkforsecs", "promiseResolve"],
]);

/**
 * Extension opcodes that are deterministic without journaling.
 * All other `${extensionId}_*` opcodes from loaded extensions are unsupported.
 */
export const SAFE_EXTENSION_OPCODES = new Set<string>([]);

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Read declared extension IDs from a rewind origin snapshot. */
export function extractExtensionIds(
  origin: RewindOrigin | null | undefined,
): string[] {
  if (!origin) return [];
  const fromDocument = readStringArray(origin.document.extensions);
  const vmProjectJson =
    origin.vmProjectJson && typeof origin.vmProjectJson === "object"
      ? (origin.vmProjectJson as {extensions?: unknown})
      : null;
  const fromVm = readStringArray(vmProjectJson?.extensions);
  return [...new Set([...fromDocument, ...fromVm])].sort();
}

/** True when the opcode reads procedure parameters already captured in stack frames. */
export function isDeterministicProcedureReporterOpcode(opcode: string): boolean {
  return opcode.startsWith("argument_reporter_");
}

/** Resolve an opcode to an unjournaled journal kind, if any. */
export function resolveNonDeterministicOpcode(
  opcode: string,
  extensionIds: readonly string[],
): JournalEntryKind | null {
  if (isDeterministicProcedureReporterOpcode(opcode)) {
    return null;
  }

  const mapped = OPCODE_JOURNAL_KIND.get(opcode);
  if (mapped) return mapped;

  for (const extensionId of extensionIds) {
    const prefix = `${extensionId}_`;
    if (!opcode.startsWith(prefix)) continue;
    if (SAFE_EXTENSION_OPCODES.has(opcode)) return null;
    return "extensionReporter";
  }

  return null;
}

export function isUnsupportedNonDeterministicOpcode(
  opcode: string,
  extensionIds: readonly string[],
): boolean {
  const journalKind = resolveNonDeterministicOpcode(opcode, extensionIds);
  return journalKind !== null && !IMPLEMENTED_JOURNAL_KINDS.has(journalKind);
}

/** @deprecated Use {@link resolveNonDeterministicOpcode}. */
export function isNonDeterministicOpcode(opcode: string): JournalEntryKind | null {
  return resolveNonDeterministicOpcode(opcode, []);
}
