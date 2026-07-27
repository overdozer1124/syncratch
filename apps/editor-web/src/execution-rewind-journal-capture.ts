import type {JournalEntry} from "./execution-rewind-types.js";
import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";

export type JournalCaptureRuntimeLike = {
  getOpcodeFunction?: (opcode: string) => unknown;
  ioDevices?: {
    clock?: {
      projectTimer?: () => number;
      __syncratchRewindOriginalNow?: () => number;
      now?: () => number;
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
  clock: NonNullable<JournalCaptureRuntimeLike["ioDevices"]>["clock"],
  journal: RewindJournal,
): void {
  if (!clock || clock.__syncratchRewindOriginalNow) return;
  const originalNow = clock.now?.bind(clock);
  const originalProjectTimer = clock.projectTimer?.bind(clock);
  if (typeof originalNow !== "function") return;

  clock.__syncratchRewindOriginalNow = originalNow;
  clock.now = () => {
    const mode = journal.getMode();
    if (mode === "replay") {
      const entry = journal.consume("clock");
      if (!entry || entry.kind !== "clock") {
        throw new RewindJournalMismatchError("Expected clock journal entry");
      }
      return entry.nowMs;
    }
    const nowMs = originalNow();
    const projectTimer =
      typeof originalProjectTimer === "function" ? originalProjectTimer() : 0;
    if (mode === "record") {
      journal.append({kind: "clock", projectTimer, nowMs});
    }
    return nowMs;
  };
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

export function installJournalCapture(
  runtime: JournalCaptureRuntimeLike,
  journal: RewindJournal,
): () => void {
  if ((runtime as Record<string, unknown>)[JOURNAL_WRAP_FLAG]) {
    return () => undefined;
  }

  const originalGetOpcodeFunction = runtime.getOpcodeFunction?.bind(runtime);
  const wrappedByOpcode = new Map<string, (...args: unknown[]) => unknown>();

  if (originalGetOpcodeFunction) {
    runtime.getOpcodeFunction = (opcode: string) => {
      const original = originalGetOpcodeFunction(opcode);
      if (typeof original !== "function") return original;
      if (opcode !== "operator_random") return original;
      let wrapped = wrappedByOpcode.get(opcode);
      if (!wrapped) {
        wrapped = wrapRandomPrimitive(
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
  patchClock(clock, journal);
  patchMouse(mouse, journal);
  patchKeyboard(keyboard, journal);

  (runtime as Record<string, unknown>)[JOURNAL_WRAP_FLAG] = true;

  return () => {
    if (originalGetOpcodeFunction) {
      runtime.getOpcodeFunction = originalGetOpcodeFunction;
    }
    wrappedByOpcode.clear();
    if (clock?.__syncratchRewindOriginalNow) {
      clock.now = clock.__syncratchRewindOriginalNow;
      delete clock.__syncratchRewindOriginalNow;
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
