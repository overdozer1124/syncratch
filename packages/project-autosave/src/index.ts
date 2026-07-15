/**
 * @experimental R1 generation-aware debounce autosave.
 */

import { randomUUID } from "node:crypto";
import type { ProjectDocument } from "@blocksync/project-schema";

export type SaveState = "clean" | "dirty" | "saving" | "error" | "conflict";

export interface AutosaveControllerOptions {
  debounceMs: number;
  retryDelaysMs: number[];
  save: (args: {
    baseRevision: number;
    transactionId: string;
    schemaVersion: number;
    document: ProjectDocument;
  }) => Promise<{ revision: number }>;
  getBaseRevision: () => number;
  setBaseRevision: (r: number) => void;
  onState?: (s: SaveState) => void;
  idFactory?: () => string;
}

export interface AutosaveController {
  getState(): SaveState;
  notifyLocalEdit(document: ProjectDocument): void;
  flush(): Promise<void>;
  dispose(): void;
}

export function createAutosaveController(
  opts: AutosaveControllerOptions,
): AutosaveController {
  const idFactory = opts.idFactory ?? (() => randomUUID());
  let state: SaveState = "clean";
  let disposed = false;
  let generation = 0;
  let pendingDocument: ProjectDocument | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let activeTransactionId: string | null = null;
  let activeGeneration: number | null = null;
  let activeDocument: ProjectDocument | null = null;
  let retryAttempt = 0;

  const setState = (next: SaveState) => {
    if (disposed) return;
    state = next;
    opts.onState?.(next);
  };

  const clearDebounce = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const scheduleDebounce = () => {
    clearDebounce();
    if (disposed) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSave();
    }, opts.debounceMs);
  };

  const runSave = async (): Promise<void> => {
    if (disposed) return;
    if (inFlight) {
      await inFlight;
      if (disposed || !pendingDocument || state === "clean" || state === "conflict") {
        return;
      }
      // Fall through to save newer pending work after the in-flight request finishes.
    }
    if (!pendingDocument) return;

    const sentGeneration = generation;
    const document = pendingDocument;
    const schemaVersion = document.schemaVersion;
    if (!activeTransactionId || activeGeneration !== sentGeneration) {
      activeTransactionId = idFactory();
      activeGeneration = sentGeneration;
      activeDocument = document;
      retryAttempt = 0;
    }

    const transactionId = activeTransactionId;
    const baseRevision = opts.getBaseRevision();
    setState("saving");

    const work = (async () => {
      try {
        const result = await opts.save({
          baseRevision,
          transactionId,
          schemaVersion,
          document: activeDocument!,
        });
        if (disposed) return;
        opts.setBaseRevision(result.revision);
        activeTransactionId = null;
        activeGeneration = null;
        activeDocument = null;
        retryAttempt = 0;
        if (generation > sentGeneration && pendingDocument) {
          setState("dirty");
          scheduleDebounce();
        } else {
          pendingDocument = null;
          setState("clean");
        }
      } catch (err) {
        if (disposed) return;
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        if (code === "STALE_REVISION" || code === "TRANSACTION_PAYLOAD_MISMATCH") {
          setState("conflict");
          clearRetry();
          return;
        }
        if (retryAttempt < opts.retryDelaysMs.length) {
          const delay = opts.retryDelaysMs[retryAttempt]!;
          retryAttempt += 1;
          setState("error");
          clearRetry();
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void runSave();
          }, delay);
        } else {
          setState("error");
        }
      }
    })();

    inFlight = work.finally(() => {
      inFlight = null;
    });
    await inFlight;
  };

  return {
    getState: () => state,
    notifyLocalEdit(document) {
      if (disposed) return;
      generation += 1;
      pendingDocument = document;
      if (state !== "saving") {
        setState("dirty");
      }
      scheduleDebounce();
    },
    async flush() {
      if (disposed) return;
      clearDebounce();
      await runSave();
      while (!disposed && pendingDocument && state === "dirty") {
        clearDebounce();
        await runSave();
      }
    },
    dispose() {
      disposed = true;
      clearDebounce();
      clearRetry();
      pendingDocument = null;
      activeTransactionId = null;
      activeDocument = null;
    },
  };
}
