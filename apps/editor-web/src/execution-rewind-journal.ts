import {
  REWIND_MAX_JOURNAL_BYTES,
  type JournalEntry,
  type JournalEntryKind,
} from "./execution-rewind-types.js";

export type JournalMode = "record" | "replay" | "idle";

function entryByteSize(entry: JournalEntry): number {
  try {
    return new TextEncoder().encode(JSON.stringify(entry)).length;
  } catch {
    return 64;
  }
}

export class RewindJournal {
  private entries: JournalEntry[] = [];
  private totalBytes = 0;
  private mode: JournalMode = "idle";
  private replayCursor = 0;
  private replayEnd = 0;

  get size(): number {
    return this.entries.length;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  getMode(): JournalMode {
    return this.mode;
  }

  getReplayCursor(): number {
    return this.replayCursor;
  }

  getReplayEnd(): number {
    return this.replayEnd;
  }

  clear(): void {
    this.entries = [];
    this.totalBytes = 0;
    this.replayCursor = 0;
    this.replayEnd = 0;
    this.mode = "idle";
  }

  beginRecord(): void {
    this.mode = "record";
  }

  beginReplay(start: number, end: number): void {
    this.mode = "replay";
    this.replayCursor = start;
    this.replayEnd = end;
  }

  endFrame(): void {
    if (this.mode === "replay" || this.mode === "record") {
      this.mode = "idle";
    }
  }

  append(entry: JournalEntry): number {
    if (this.mode !== "record") return -1;
    const index = this.entries.length;
    const bytes = entryByteSize(entry);
    this.entries.push(entry);
    this.totalBytes += bytes;
    return index;
  }

  exceedsByteLimit(maxBytes = REWIND_MAX_JOURNAL_BYTES): boolean {
    return this.totalBytes > maxBytes;
  }

  slice(start: number, end: number): JournalEntry[] {
    return this.entries.slice(start, end);
  }

  /** True when the active replay range has been fully consumed. */
  replayRangeFullyConsumed(): boolean {
    return this.replayCursor >= this.replayEnd;
  }

  /** Replay the next journal entry of `kind`, or null when replay range is exhausted. */
  consume(kind: JournalEntryKind): JournalEntry | null {
    if (this.mode !== "replay") return null;
    if (this.replayCursor >= this.replayEnd) return null;
    const entry = this.entries[this.replayCursor];
    if (!entry || entry.kind !== kind) {
      throw new RewindJournalMismatchError(
        `Expected journal entry kind ${kind} at index ${this.replayCursor}, got ${entry?.kind ?? "none"}`,
      );
    }
    this.replayCursor += 1;
    return entry;
  }

  peekReplayEntry(): JournalEntry | null {
    if (this.mode !== "replay") return null;
    if (this.replayCursor >= this.replayEnd) return null;
    return this.entries[this.replayCursor] ?? null;
  }

  cloneEntries(): JournalEntry[] {
    return this.entries.map(entry => structuredClone(entry));
  }

  restoreEntries(entries: JournalEntry[]): void {
    this.entries = entries.map(entry => structuredClone(entry));
    this.totalBytes = entries.reduce((sum, entry) => sum + entryByteSize(entry), 0);
    this.replayCursor = 0;
    this.replayEnd = 0;
    this.mode = "idle";
  }

  /** Drop entries appended after `size` (idle scheduler ticks). */
  truncateTo(size: number): void {
    if (size < 0 || size >= this.entries.length) return;
    const removed = this.entries.splice(size);
    for (const entry of removed) {
      this.totalBytes -= entryByteSize(entry);
    }
  }
}

export class RewindJournalMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RewindJournalMismatchError";
  }
}

export class RewindJournalUnconsumedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RewindJournalUnconsumedError";
  }
}
