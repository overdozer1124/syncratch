import type {JournalEntry} from "./execution-rewind-types.js";
import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";
import {
  IMPLEMENTED_JOURNAL_KINDS,
  resolveNonDeterministicOpcode,
} from "./execution-rewind-non-deterministic.js";

type PromiseResolveJournalEntry = Extract<
  JournalEntry,
  {kind: "promiseResolve"}
>;

type Deferred = {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
};

const PROMISE_WRAP_FLAG = "__syncratchRewindPromiseWrap";

let nextPromiseToken = 0;
const pendingRecordEntries: PromiseResolveJournalEntry[] = [];
const replayDeferreds: Deferred[] = [];

function createDeferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

export function isPromiseValue(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Promise<unknown>).then === "function"
  );
}

function appendPromiseResolveEntry(
  journal: RewindJournal,
  entry: PromiseResolveJournalEntry,
): void {
  if (journal.getMode() === "record") {
    journal.append(entry);
    return;
  }
  pendingRecordEntries.push(entry);
}

export function enqueueReplayPromise(): Promise<unknown> {
  const deferred = createDeferred();
  replayDeferreds.push(deferred);
  return deferred.promise;
}

export function recordPromiseResolveValue(
  journal: RewindJournal,
  value: unknown,
): void {
  const token = nextPromiseToken;
  nextPromiseToken += 1;
  appendPromiseResolveEntry(journal, {
    kind: "promiseResolve",
    token,
    value,
  });
}

export function recordPromiseResult(
  journal: RewindJournal,
  result: unknown,
): unknown {
  if (!isPromiseValue(result)) {
    return result;
  }
  return result.then(value => {
    recordPromiseResolveValue(journal, value);
    return value;
  });
}

/** Flush promise journal entries resolved in the same scheduler frame. */
export function flushPendingPromiseJournalEntries(
  journal: RewindJournal,
): void {
  if (journal.getMode() !== "record") {
    pendingRecordEntries.length = 0;
    return;
  }
  while (pendingRecordEntries.length > 0) {
    journal.append(pendingRecordEntries.shift()!);
  }
}

/** Resolve replay promises journaled for the active replay frame. */
export function flushReplayPromiseDeferreds(journal: RewindJournal): void {
  if (journal.getMode() !== "replay") return;

  while (journal.getReplayCursor() < journal.getReplayEnd()) {
    const entry = journal.slice(
      journal.getReplayCursor(),
      journal.getReplayCursor() + 1,
    )[0];
    if (!entry || entry.kind !== "promiseResolve") break;

    const consumed = journal.consume("promiseResolve") as
      | PromiseResolveJournalEntry
      | null;
    if (!consumed) break;

    const deferred = replayDeferreds.shift();
    if (!deferred) {
      throw new RewindJournalMismatchError(
        "Promise resolve journal entry without pending replay deferred",
      );
    }
    deferred.resolve(consumed.value);
  }
}

function wrapPromiseOpcode(
  original: (...args: unknown[]) => unknown,
  journal: RewindJournal,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const mode = journal.getMode();
    if (mode === "replay") {
      return enqueueReplayPromise();
    }

    const result = original(...args);
    if (mode !== "record" || !isPromiseValue(result)) {
      return result;
    }

    const token = nextPromiseToken;
    nextPromiseToken += 1;
    return result.then(
      value => {
        appendPromiseResolveEntry(journal, {
          kind: "promiseResolve",
          token,
          value,
        });
        return value;
      },
      error => {
        throw error;
      },
    );
  };
}

export type PromiseCaptureRuntimeLike = {
  getOpcodeFunction?: (opcode: string) => unknown;
};

export function installPromiseResolveCapture(input: {
  runtime: PromiseCaptureRuntimeLike;
  journal: RewindJournal;
  getExtensionIds?: () => readonly string[];
}): () => void {
  const {runtime, journal, getExtensionIds} = input;
  if ((runtime as Record<string, unknown>)[PROMISE_WRAP_FLAG]) {
    return () => undefined;
  }

  const originalGetOpcodeFunction = runtime.getOpcodeFunction?.bind(runtime);
  const wrappedByOpcode = new Map<string, (...args: unknown[]) => unknown>();

  if (originalGetOpcodeFunction) {
    runtime.getOpcodeFunction = (opcode: string) => {
      const original = originalGetOpcodeFunction(opcode);
      if (typeof original !== "function") return original;

      const journalKind = resolveNonDeterministicOpcode(
        opcode,
        getExtensionIds?.() ?? [],
      );
      if (journalKind !== "promiseResolve") {
        return original;
      }
      if (!IMPLEMENTED_JOURNAL_KINDS.has("promiseResolve")) {
        return original;
      }

      let wrapped = wrappedByOpcode.get(opcode);
      if (!wrapped) {
        wrapped = wrapPromiseOpcode(
          original as (...args: unknown[]) => unknown,
          journal,
        );
        wrappedByOpcode.set(opcode, wrapped);
      }
      return wrapped;
    };
  }

  (runtime as Record<string, unknown>)[PROMISE_WRAP_FLAG] = true;

  return () => {
    if (originalGetOpcodeFunction) {
      runtime.getOpcodeFunction = originalGetOpcodeFunction;
    }
    wrappedByOpcode.clear();
    nextPromiseToken = 0;
    pendingRecordEntries.length = 0;
    replayDeferreds.length = 0;
    (runtime as Record<string, unknown>)[PROMISE_WRAP_FLAG] = false;
  };
}
