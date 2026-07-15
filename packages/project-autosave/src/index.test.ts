import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProject, type ProjectDocument } from "@blocksync/project-schema";
import { createAutosaveController } from "./index.js";

function doc(n: number): ProjectDocument {
  const d = emptyProject();
  d.meta = { n };
  return d;
}

describe("createAutosaveController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps edit during saving dirty and uses new transactionId afterward", async () => {
    let base = 0;
    const saves: Array<{ transactionId: string; baseRevision: number; n: number }> =
      [];
    let resolveSave!: (v: { revision: number }) => void;
    const saveGate = new Promise<{ revision: number }>((r) => {
      resolveSave = r;
    });
    let call = 0;

    const ctrl = createAutosaveController({
      debounceMs: 100,
      retryDelaysMs: [50],
      getBaseRevision: () => base,
      setBaseRevision: (r) => {
        base = r;
      },
      idFactory: () => `tx-${++call}`,
      save: async (args) => {
        saves.push({
          transactionId: args.transactionId,
          baseRevision: args.baseRevision,
          n: Number((args.document.meta as { n: number }).n),
        });
        if (saves.length === 1) {
          return saveGate;
        }
        return { revision: args.baseRevision + 1 };
      },
    });

    ctrl.notifyLocalEdit(doc(1));
    await vi.advanceTimersByTimeAsync(100);
    expect(ctrl.getState()).toBe("saving");

    ctrl.notifyLocalEdit(doc(2));
    resolveSave({ revision: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrl.getState()).toBe("dirty");

    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(saves).toHaveLength(2);
    expect(saves[0]!.transactionId).toBe("tx-1");
    expect(saves[1]!.transactionId).toBe("tx-2");
    expect(saves[1]!.baseRevision).toBe(1);
    expect(saves[1]!.n).toBe(2);
    expect(ctrl.getState()).toBe("clean");
    ctrl.dispose();
  });

  it("retries with same transactionId and payload", async () => {
    let base = 0;
    const saves: string[] = [];
    let fails = 1;
    const ctrl = createAutosaveController({
      debounceMs: 50,
      retryDelaysMs: [100],
      getBaseRevision: () => base,
      setBaseRevision: (r) => {
        base = r;
      },
      idFactory: () => "tx-retry",
      save: async (args) => {
        saves.push(args.transactionId);
        if (fails > 0) {
          fails -= 1;
          throw new Error("network");
        }
        return { revision: args.baseRevision + 1 };
      },
    });

    ctrl.notifyLocalEdit(doc(1));
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(ctrl.getState()).toBe("error");
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(saves).toEqual(["tx-retry", "tx-retry"]);
    expect(ctrl.getState()).toBe("clean");
    ctrl.dispose();
  });

  it("conflict stops retry", async () => {
    const ctrl = createAutosaveController({
      debounceMs: 10,
      retryDelaysMs: [10, 10],
      getBaseRevision: () => 0,
      setBaseRevision: () => {},
      save: async () => {
        const err = new Error("STALE_REVISION") as Error & { code: string };
        err.code = "STALE_REVISION";
        throw err;
      },
    });
    ctrl.notifyLocalEdit(doc(1));
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    expect(ctrl.getState()).toBe("conflict");
    await vi.advanceTimersByTimeAsync(100);
    expect(ctrl.getState()).toBe("conflict");
    ctrl.dispose();
  });

  it("dispose clears timers", async () => {
    const save = vi.fn(async () => ({ revision: 1 }));
    const onState = vi.fn();
    const ctrl = createAutosaveController({
      debounceMs: 200,
      retryDelaysMs: [200],
      getBaseRevision: () => 0,
      setBaseRevision: () => {},
      save,
      onState,
    });
    ctrl.notifyLocalEdit(doc(1));
    ctrl.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });
});
