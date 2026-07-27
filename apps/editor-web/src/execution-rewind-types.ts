import type {ProjectDocument} from "@blocksync/project-schema";

/** Maximum scheduler frames retained for rewind. */
export const REWIND_MAX_FRAMES = 10_000;

/** Maximum total journal payload bytes before history is cleared. */
export const REWIND_MAX_JOURNAL_BYTES = 4 * 1024 * 1024;

export type RewindClearReason =
  | "code-edit"
  | "target-change"
  | "project-load"
  | "guest-restore"
  | "remote-apply"
  | "green-flag"
  | "stop"
  | "vm-blockly-desync"
  | "dispose"
  | "fingerprint-mismatch"
  | "journal-limit"
  | "frame-limit"
  | "manual";

export interface RewindOrigin {
  document: ProjectDocument;
  assets: Map<string, Uint8Array>;
  projectSessionId: number;
  blockGraphHash: string;
  /** Exact VM project JSON for deterministic reload during replay. */
  vmProjectJson?: unknown;
}

export interface RewindFrame {
  frameIndex: number;
  traceSize: number;
  journalStart: number;
  journalEnd: number;
  fingerprint: string;
}

export interface RewindSnapshot {
  canRewind: boolean;
  rewindDepth: number;
  isReplaying: boolean;
  /** User-facing generalized error message. */
  rewindError: string | null;
  /** Opcodes that disabled rewind; exposed for E2E diagnostics. */
  unsupportedOpcodes: string[];
}

export type JournalEntryKind =
  | "random"
  | "clock"
  | "mouse"
  | "key"
  | "askAnswer"
  | "loudness"
  | "videoSensing"
  | "extensionReporter"
  | "promiseResolve"
  | "cloneOrder"
  | "broadcastOrder";

export type JournalEntry =
  | {kind: "random"; from: number; to: number; value: number}
  | {kind: "clock"; projectTimer: number; currentMSecs: number}
  | {kind: "mouse"; x: number; y: number; down: boolean}
  | {kind: "key"; key: string; pressed: boolean}
  | {kind: "askAnswer"; answer: string}
  | {kind: "loudness"; value: number}
  | {kind: "videoSensing"; attribute: string; value: unknown}
  | {kind: "extensionReporter"; opcode: string; value: unknown}
  | {kind: "promiseResolve"; token: number; value: unknown}
  | {kind: "cloneOrder"; spriteName: string; cloneOrder: number; sourceIdentity: string}
  | {kind: "broadcastOrder"; broadcast: string; threadOrder: string[]};

export interface ReplayResult {
  ok: boolean;
  targetFrameIndex: number;
  expectedFingerprint: string | null;
  actualFingerprint: string | null;
  error: string | null;
}

export interface RewindFrameResult {
  ok: boolean;
  targetFrameIndex: number;
  error: string | null;
}
