import type {JournalEntry} from "./execution-rewind-types.js";
import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";
import {
  stableTargetIdentity,
  type StableTargetLike,
} from "./execution-rewind-target-identity.js";

const BROADCAST_RECEIVED_OPCODE = "event_whenbroadcastreceived";
const START_HATS_WRAP_FLAG = "__syncratchRewindStartHatsWrap";

type BroadcastOrderJournalEntry = Extract<JournalEntry, {kind: "broadcastOrder"}>;

export type BroadcastOrderThreadLike = {
  topBlock?: string | null;
  target?: StableTargetLike | null;
};

export type BroadcastOrderRuntimeLike = {
  startHats?: (
    requestedHatOpcode: string,
    optMatchFields?: Record<string, unknown>,
    optTarget?: unknown,
  ) => BroadcastOrderThreadLike[] | undefined | void;
  threads?: unknown[];
};

export function stableBroadcastThreadIdentity(
  thread: BroadcastOrderThreadLike,
): string {
  return `${stableTargetIdentity(thread.target ?? {})}:${thread.topBlock ?? ""}`;
}

function readBroadcastName(optMatchFields?: Record<string, unknown>): string {
  const value = optMatchFields?.BROADCAST_OPTION;
  if (typeof value === "string") return value.toUpperCase();
  return String(value ?? "").toUpperCase();
}

function reorderStartedThreads(
  startedThreads: BroadcastOrderThreadLike[],
  threadOrder: string[],
): BroadcastOrderThreadLike[] {
  const byIdentity = new Map<string, BroadcastOrderThreadLike>();
  for (const thread of startedThreads) {
    byIdentity.set(stableBroadcastThreadIdentity(thread), thread);
  }

  const ordered: BroadcastOrderThreadLike[] = [];
  for (const identity of threadOrder) {
    const thread = byIdentity.get(identity);
    if (!thread) {
      throw new RewindJournalMismatchError(
        `Missing broadcast thread identity ${identity}`,
      );
    }
    ordered.push(thread);
  }

  if (ordered.length !== startedThreads.length) {
    throw new RewindJournalMismatchError("Broadcast thread count mismatch");
  }
  return ordered;
}

function reorderRuntimeThreads(
  runtimeThreads: unknown[],
  startedThreads: BroadcastOrderThreadLike[],
  orderedStarted: BroadcastOrderThreadLike[],
): void {
  const indices = startedThreads
    .map(thread => runtimeThreads.indexOf(thread))
    .filter(index => index >= 0);
  if (indices.length !== startedThreads.length) return;

  const sortedIndices = [...indices].sort((left, right) => left - right);
  for (let index = sortedIndices.length - 1; index >= 0; index -= 1) {
    runtimeThreads.splice(sortedIndices[index]!, 1);
  }
  runtimeThreads.splice(sortedIndices[0] ?? runtimeThreads.length, 0, ...orderedStarted);
}

function recordBroadcastOrder(
  journal: RewindJournal,
  broadcast: string,
  startedThreads: BroadcastOrderThreadLike[],
): void {
  journal.append({
    kind: "broadcastOrder",
    broadcast,
    threadOrder: startedThreads.map(stableBroadcastThreadIdentity),
  });
}

function replayBroadcastOrder(
  journal: RewindJournal,
  broadcast: string,
  startedThreads: BroadcastOrderThreadLike[],
  runtimeThreads: unknown[] | undefined,
): BroadcastOrderThreadLike[] {
  const entry = journal.consume("broadcastOrder") as
    | BroadcastOrderJournalEntry
    | undefined;
  if (!entry || entry.kind !== "broadcastOrder") {
    throw new RewindJournalMismatchError("Expected broadcastOrder journal entry");
  }
  if (entry.broadcast !== broadcast) {
    throw new RewindJournalMismatchError(
      `Expected broadcast ${broadcast}, got ${entry.broadcast}`,
    );
  }

  const ordered = reorderStartedThreads(startedThreads, entry.threadOrder);
  if (Array.isArray(runtimeThreads)) {
    reorderRuntimeThreads(runtimeThreads, startedThreads, ordered);
  }
  return ordered;
}

export function installBroadcastOrderCapture(input: {
  runtime: BroadcastOrderRuntimeLike;
  journal: RewindJournal;
}): () => void {
  const {runtime, journal} = input;
  if ((runtime as Record<string, unknown>)[START_HATS_WRAP_FLAG]) {
    return () => undefined;
  }

  const originalStartHats = runtime.startHats?.bind(runtime);
  if (typeof originalStartHats !== "function") {
    return () => undefined;
  }

  runtime.startHats = (
    requestedHatOpcode: string,
    optMatchFields?: Record<string, unknown>,
    optTarget?: unknown,
  ) => {
    const startedThreads = originalStartHats(
      requestedHatOpcode,
      optMatchFields,
      optTarget,
    );
    if (
      requestedHatOpcode !== BROADCAST_RECEIVED_OPCODE ||
      !Array.isArray(startedThreads)
    ) {
      return startedThreads;
    }

    const broadcast = readBroadcastName(optMatchFields);
    const mode = journal.getMode();
    if (mode === "record") {
      recordBroadcastOrder(journal, broadcast, startedThreads);
      return startedThreads;
    }
    if (mode === "replay") {
      return replayBroadcastOrder(
        journal,
        broadcast,
        startedThreads,
        runtime.threads,
      );
    }
    return startedThreads;
  };

  (runtime as Record<string, unknown>)[START_HATS_WRAP_FLAG] = true;

  return () => {
    runtime.startHats = originalStartHats;
    (runtime as Record<string, unknown>)[START_HATS_WRAP_FLAG] = false;
  };
}
