import type {JournalEntry, JournalEntryKind} from "./execution-rewind-types.js";
import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";
import {
  IMPLEMENTED_JOURNAL_KINDS,
  resolveNonDeterministicOpcode,
} from "./execution-rewind-non-deterministic.js";

type ClockJournalEntry = Extract<JournalEntry, {kind: "clock"}>;

export type JournalCaptureRuntimeLike = {
  currentMSecs?: number;
  updateCurrentMSecs?: () => void;
  getOpcodeFunction?: (opcode: string) => unknown;
  ioDevices?: {
    clock?: {
      projectTimer?: () => number;
      __syncratchRewindOriginalProjectTimer?: () => number;
    };
    mouse?: {
      getScratchX?: () => number;
      getScratchY?: () => number;
      getIsDown?: () => boolean;
      __syncratchRewindOriginalGetScratchX?: () => number;
      __syncratchRewindOriginalGetScratchY?: () => number;
      __syncratchRewindOriginalGetIsDown?: () => boolean;
    };
    keyboard?: {
      getKeyIsDown?: (key: string) => boolean;
      __syncratchRewindOriginalGetKeyIsDown?: (key: string) => boolean;
    };
  };
};

const JOURNAL_WRAP_FLAG = "__syncratchRewindJournalWrap";

type RandomJournalEntry = Extract<JournalEntry, {kind: "random"}>;

export type JournalCaptureOptions = {
  getExtensionIds?: () => readonly string[];
  onUnsupportedInput?: (detail: {
    opcode: string;
    journalKind: import("./execution-rewind-types.js").JournalEntryKind;
  }) => void;
};

function readClockSnapshot(
  runtime: JournalCaptureRuntimeLike,
  clock: NonNullable<JournalCaptureRuntimeLike["ioDevices"]>["clock"],
  readProjectTimer: () => number,
): ClockJournalEntry {
  return {
    kind: "clock",
    projectTimer: readProjectTimer(),
    currentMSecs: runtime.currentMSecs ?? 0,
  };
}

function applyClockSnapshot(
  runtime: JournalCaptureRuntimeLike,
  entry: ClockJournalEntry,
): void {
  runtime.currentMSecs = entry.currentMSecs;
}

function wrapRandomPrimitive(
  original: (...args: unknown[]) => unknown,
  journal: RewindJournal,
): (...args: unknown[]) => unknown {
  return ((args: {FROM?: number; TO?: number}) => {
    const mode = journal.getMode();
    if (mode === "replay") {
      const entry = journal.consume("random") as RandomJournalEntry;
      return entry.value;
    }
    const result = original.call(null, args);
    if (mode === "record") {
      const numeric =
        typeof result === "number" && Number.isFinite(result) ? result : 0;
      journal.append({
        kind: "random",
        from: Number(args.FROM ?? 1),
        to: Number(args.TO ?? 0),
        value: numeric,
      });
    }
    return result;
  }) as (...args: unknown[]) => unknown;
}

function patchClock(
  runtime: JournalCaptureRuntimeLike,
  clock: NonNullable<JournalCaptureRuntimeLike["ioDevices"]>["clock"],
  journal: RewindJournal,
): void {
  if (!clock || clock.__syncratchRewindOriginalProjectTimer) return;
  const originalProjectTimer = clock.projectTimer?.bind(clock);
  const originalUpdateCurrentMSecs = runtime.updateCurrentMSecs?.bind(runtime);
  if (typeof originalProjectTimer !== "function") return;

  clock.__syncratchRewindOriginalProjectTimer = originalProjectTimer;

  clock.projectTimer = () => {
    const mode = journal.getMode();
    if (mode === "replay") {
      const entry = journal.consume("clock");
      if (!entry || entry.kind !== "clock") {
        throw new RewindJournalMismatchError("Expected clock journal entry");
      }
      applyClockSnapshot(runtime, entry);
      return entry.projectTimer;
    }
    const projectTimer = originalProjectTimer();
    if (mode === "record") {
      journal.append(
        readClockSnapshot(runtime, clock, () => projectTimer),
      );
    }
    return projectTimer;
  };

  if (typeof originalUpdateCurrentMSecs === "function") {
    runtime.updateCurrentMSecs = () => {
      const mode = journal.getMode();
      if (mode === "replay") {
        const entry = journal.consume("clock");
        if (!entry || entry.kind !== "clock") {
          throw new RewindJournalMismatchError("Expected clock journal entry");
        }
        applyClockSnapshot(runtime, entry);
        return;
      }
      originalUpdateCurrentMSecs();
      if (mode === "record") {
        journal.append(
          readClockSnapshot(runtime, clock, originalProjectTimer),
        );
      }
    };
  }
}

function patchMouse(
  mouse: NonNullable<JournalCaptureRuntimeLike["ioDevices"]>["mouse"],
  journal: RewindJournal,
): void {
  if (!mouse || mouse.__syncratchRewindOriginalGetScratchX) return;
  const originalX = mouse.getScratchX?.bind(mouse);
  const originalY = mouse.getScratchY?.bind(mouse);
  const originalDown = mouse.getIsDown?.bind(mouse);
  if (typeof originalX !== "function" || typeof originalY !== "function") return;

  mouse.__syncratchRewindOriginalGetScratchX = originalX;
  mouse.__syncratchRewindOriginalGetScratchY = originalY;
  mouse.__syncratchRewindOriginalGetIsDown = originalDown;

  const readMouse = () => {
    const mode = journal.getMode();
    if (mode === "replay") {
      const entry = journal.consume("mouse");
      if (!entry || entry.kind !== "mouse") {
        throw new RewindJournalMismatchError("Expected mouse journal entry");
      }
      return entry;
    }
    const x = originalX();
    const y = originalY();
    const down = typeof originalDown === "function" ? originalDown() : false;
    if (mode === "record") {
      journal.append({kind: "mouse", x, y, down});
    }
    return {x, y, down};
  };

  mouse.getScratchX = () => readMouse().x;
  mouse.getScratchY = () => readMouse().y;
  mouse.getIsDown = () => readMouse().down;
}

function patchKeyboard(
  keyboard: NonNullable<JournalCaptureRuntimeLike["ioDevices"]>["keyboard"],
  journal: RewindJournal,
): void {
  if (!keyboard || keyboard.__syncratchRewindOriginalGetKeyIsDown) return;
  const original = keyboard.getKeyIsDown?.bind(keyboard);
  if (typeof original !== "function") return;
  keyboard.__syncratchRewindOriginalGetKeyIsDown = original;
  keyboard.getKeyIsDown = (key: string) => {
    const mode = journal.getMode();
    if (mode === "replay") {
      const entry = journal.consume("key");
      if (!entry || entry.kind !== "key") {
        throw new RewindJournalMismatchError("Expected key journal entry");
      }
      if (entry.key !== key) {
        throw new RewindJournalMismatchError(
          `Expected key journal entry for ${key}, got ${entry.key}`,
        );
      }
      return entry.pressed;
    }
    const pressed = original(key);
    if (mode === "record") {
      journal.append({kind: "key", key, pressed});
    }
    return pressed;
  };
}

type LoudnessJournalEntry = Extract<JournalEntry, {kind: "loudness"}>;
type AskAnswerJournalEntry = Extract<JournalEntry, {kind: "askAnswer"}>;
type VideoSensingJournalEntry = Extract<JournalEntry, {kind: "videoSensing"}>;
type ExtensionReporterJournalEntry = Extract<
  JournalEntry,
  {kind: "extensionReporter"}
>;

function stableVideoSensingAttribute(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function replayJournalValue(
  journal: RewindJournal,
  kind: JournalEntryKind,
  opcode: string,
  args: unknown,
): unknown {
  const entry = journal.consume(kind);
  if (!entry || entry.kind !== kind) {
    throw new RewindJournalMismatchError(`Expected ${kind} journal entry`);
  }
  switch (kind) {
    case "loudness":
      return (entry as LoudnessJournalEntry).value;
    case "askAnswer":
      return (entry as AskAnswerJournalEntry).answer;
    case "videoSensing": {
      const videoEntry = entry as VideoSensingJournalEntry;
      if (videoEntry.attribute !== stableVideoSensingAttribute(args)) {
        throw new RewindJournalMismatchError(
          `Expected videoSensing attribute ${stableVideoSensingAttribute(args)}, got ${videoEntry.attribute}`,
        );
      }
      return videoEntry.value;
    }
    case "extensionReporter": {
      const reporterEntry = entry as ExtensionReporterJournalEntry;
      if (reporterEntry.opcode !== opcode) {
        throw new RewindJournalMismatchError(
          `Expected extensionReporter for ${opcode}, got ${reporterEntry.opcode}`,
        );
      }
      return reporterEntry.value;
    }
    default:
      throw new RewindJournalMismatchError(`Unsupported replay kind ${kind}`);
  }
}

function recordJournalValue(
  journal: RewindJournal,
  kind: JournalEntryKind,
  opcode: string,
  args: unknown,
  result: unknown,
): void {
  switch (kind) {
    case "loudness":
      journal.append({
        kind: "loudness",
        value:
          typeof result === "number" && Number.isFinite(result) ? result : 0,
      });
      return;
    case "askAnswer":
      journal.append({
        kind: "askAnswer",
        answer: typeof result === "string" ? result : String(result ?? ""),
      });
      return;
    case "videoSensing":
      journal.append({
        kind: "videoSensing",
        attribute: stableVideoSensingAttribute(args),
        value: result,
      });
      return;
    case "extensionReporter":
      journal.append({kind: "extensionReporter", opcode, value: result});
      return;
    default:
      return;
  }
}

function wrapJournaledOpcode(
  opcode: string,
  kind: JournalEntryKind,
  original: (...args: unknown[]) => unknown,
  journal: RewindJournal,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const mode = journal.getMode();
    if (mode === "replay") {
      return replayJournalValue(journal, kind, opcode, args[0]);
    }
    const result = original(...args);
    if (mode === "record") {
      recordJournalValue(journal, kind, opcode, args[0], result);
    }
    return result;
  };
}

export function installJournalCapture(
  runtime: JournalCaptureRuntimeLike,
  journal: RewindJournal,
  options: JournalCaptureOptions = {},
): () => void {
  if ((runtime as Record<string, unknown>)[JOURNAL_WRAP_FLAG]) {
    return () => undefined;
  }

  const originalGetOpcodeFunction = runtime.getOpcodeFunction?.bind(runtime);
  const wrappedByOpcode = new Map<string, (...args: unknown[]) => unknown>();
  const originalUpdateCurrentMSecs = runtime.updateCurrentMSecs?.bind(runtime);

  if (originalGetOpcodeFunction) {
    runtime.getOpcodeFunction = (opcode: string) => {
      const original = originalGetOpcodeFunction(opcode);
      if (typeof original !== "function") return original;

      const extensionIds = options.getExtensionIds?.() ?? [];
      const journalKind = resolveNonDeterministicOpcode(opcode, extensionIds);
      if (
        journalKind &&
        journal.getMode() === "record" &&
        !IMPLEMENTED_JOURNAL_KINDS.has(journalKind)
      ) {
        options.onUnsupportedInput?.({opcode, journalKind});
      }

      const captureKind =
        journalKind &&
        IMPLEMENTED_JOURNAL_KINDS.has(journalKind) &&
        journalKind !== "broadcastOrder"
          ? journalKind
          : opcode === "operator_random"
            ? ("random" as const)
            : null;

      if (!captureKind) return original;

      let wrapped = wrappedByOpcode.get(opcode);
      if (!wrapped) {
        wrapped =
          captureKind === "random"
            ? wrapRandomPrimitive(
                original as (...args: unknown[]) => unknown,
                journal,
              )
            : wrapJournaledOpcode(
                opcode,
                captureKind,
                original as (...args: unknown[]) => unknown,
                journal,
              );
        wrappedByOpcode.set(opcode, wrapped);
      }
      return wrapped;
    };
  }

  const clock = runtime.ioDevices?.clock;
  const mouse = runtime.ioDevices?.mouse;
  const keyboard = runtime.ioDevices?.keyboard;
  patchClock(runtime, clock, journal);
  patchMouse(mouse, journal);
  patchKeyboard(keyboard, journal);

  (runtime as Record<string, unknown>)[JOURNAL_WRAP_FLAG] = true;

  return () => {
    if (originalGetOpcodeFunction) {
      runtime.getOpcodeFunction = originalGetOpcodeFunction;
    }
    wrappedByOpcode.clear();
    if (clock?.__syncratchRewindOriginalProjectTimer) {
      clock.projectTimer = clock.__syncratchRewindOriginalProjectTimer;
      delete clock.__syncratchRewindOriginalProjectTimer;
    }
    if (originalUpdateCurrentMSecs) {
      runtime.updateCurrentMSecs = originalUpdateCurrentMSecs;
    }
    if (mouse?.__syncratchRewindOriginalGetScratchX) {
      mouse.getScratchX = mouse.__syncratchRewindOriginalGetScratchX;
      mouse.getScratchY = mouse.__syncratchRewindOriginalGetScratchY!;
      if (mouse.__syncratchRewindOriginalGetIsDown) {
        mouse.getIsDown = mouse.__syncratchRewindOriginalGetIsDown;
      }
      delete mouse.__syncratchRewindOriginalGetScratchX;
      delete mouse.__syncratchRewindOriginalGetScratchY;
      delete mouse.__syncratchRewindOriginalGetIsDown;
    }
    if (keyboard?.__syncratchRewindOriginalGetKeyIsDown) {
      keyboard.getKeyIsDown = keyboard.__syncratchRewindOriginalGetKeyIsDown;
      delete keyboard.__syncratchRewindOriginalGetKeyIsDown;
    }
    (runtime as Record<string, unknown>)[JOURNAL_WRAP_FLAG] = false;
  };
}
