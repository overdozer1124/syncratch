import { describe, expect, it } from "vitest";
import {
  exportSb3,
  loadSb3,
  loadSb3Isolated,
  semanticFingerprint,
} from "../src/index.js";
import {
  emptyProject,
  type ProjectDocument,
} from "@blocksync/project-schema";
import { createAdapter, loadProjectJson } from "@blocksync/scratch-adapter";
import JSZip from "jszip";

function sampleDoc(): ProjectDocument {
  const base = emptyProject();
  base.targets.push({
    id: "sprite1",
    name: "Sprite1",
    isStage: false,
    variables: { v1: ["steps", 0] },
    blocks: {
      hat: {
        id: "hat",
        opcode: "event_whenflagclicked",
        next: "set",
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
        x: 0,
        y: 0,
      },
      set: {
        id: "set",
        opcode: "data_setvariableto",
        next: "move",
        parent: "hat",
        inputs: { VALUE: [1, [10, "3"]] },
        fields: { VARIABLE: ["steps", "v1"] },
        topLevel: false,
      },
      move: {
        id: "move",
        opcode: "motion_movesteps",
        next: null,
        parent: "set",
        inputs: { STEPS: [1, [4, "10"]] },
        fields: {},
        topLevel: false,
      },
    },
  });
  return base;
}

describe("sb3-tools", () => {
  it("round-trips semantically with matching asset hashes", async () => {
    const doc = sampleDoc();
    const bytes = await exportSb3(doc);
    const loaded = await loadSb3(bytes);
    expect(loaded.ok).toBe(true);
    expect(semanticFingerprint(loaded.document!)).toBe(semanticFingerprint(doc));
    expect(loaded.issues.some((i) => i.code === "ASSET_HASH_MISMATCH")).toBe(
      false,
    );
  });

  it("rejects absolute path zip entries", async () => {
    const zip = new JSZip();
    zip.file("/tmp/evil.json", "{}");
    zip.file(
      "project.json",
      JSON.stringify({
        targets: [
          {
            isStage: true,
            name: "Stage",
            blocks: {},
            variables: {},
            lists: {},
            broadcasts: {},
            costumes: [],
            sounds: [],
          },
        ],
      }),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const loaded = await loadSb3(bytes);
    expect(loaded.ok).toBe(false);
    expect(loaded.issues.some((i) => i.code === "ABSOLUTE_PATH")).toBe(true);
  });

  it("rejects oversized entry by declared uncompressed size before full inflate", async () => {
    const zip = new JSZip();
    zip.file("project.json", JSON.stringify({ targets: [] }));
    // 64KiB stored entry — must be rejected by declaration/budget, not only after full alloc
    zip.file("big.bin", "x".repeat(64 * 1024));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "STORE",
    });
    const loaded = await loadSb3(bytes, {
      maxBytes: 5_000_000,
      maxEntries: 200,
      maxUncompressedBytes: 1000,
      maxCompressionRatio: 100,
      maxDepth: 4,
    });
    expect(loaded.ok).toBe(false);
    expect(loaded.issues.some((i) => i.code === "TOO_LARGE")).toBe(true);
    expect(
      loaded.issues.some((i) => i.message.includes("declared uncompressed")),
    ).toBe(true);
  });

  it("isolated loader also rejects declared-oversize entries", async () => {
    const zip = new JSZip();
    zip.file("project.json", JSON.stringify({ targets: [] }));
    zip.file("big.bin", "x".repeat(64 * 1024));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "STORE",
    });
    const loaded = await loadSb3Isolated(
      bytes,
      {
        maxBytes: 5_000_000,
        maxEntries: 200,
        maxUncompressedBytes: 1000,
        maxCompressionRatio: 100,
        maxDepth: 4,
      },
      { heapMb: 64 },
    );
    expect(loaded.ok).toBe(false);
    expect(loaded.issues.some((i) => i.code === "TOO_LARGE")).toBe(true);
    expect(loaded.childExited).toBe(true);
    expect(loaded.timedOut).toBe(false);
  }, 20_000);

  it("isolated loader times out when worker is held, then cleans up", async () => {
    const zip = new JSZip();
    zip.file(
      "project.json",
      JSON.stringify({
        targets: [
          {
            isStage: true,
            name: "Stage",
            blocks: {},
            variables: {},
            lists: {},
            broadcasts: {},
            costumes: [],
            sounds: [],
          },
        ],
      }),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const timeoutMs = 400;
    const workerHoldMs = 60_000; // far longer than timeout — stable, not flaky
    const started = Date.now();
    let resolveCount = 0;
    const pending = loadSb3Isolated(bytes, {}, { timeoutMs, workerHoldMs }).then(
      (r) => {
        resolveCount += 1;
        return r;
      },
    );
    const loaded = await pending;
    const elapsed = Date.now() - started;

    expect(loaded.timedOut).toBe(true);
    expect(loaded.ok).toBe(false);
    expect(loaded.childExited).toBe(true);
    expect(loaded.issues.some((i) => i.message.includes("timed out"))).toBe(
      true,
    );
    // Resolve within timeout + kill/grace budget (not waiting for worker hold)
    expect(elapsed).toBeLessThan(timeoutMs + 5_000);
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
    expect(resolveCount).toBe(1);

    // Child must be gone (ESRCH / falsy kill)
    if (loaded.childPid != null) {
      let alive = true;
      try {
        alive = process.kill(loaded.childPid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    }

    // Parent still usable: another isolated call succeeds path (rejects oversize)
    const zip2 = new JSZip();
    zip2.file("project.json", JSON.stringify({ targets: [] }));
    zip2.file("big.bin", "y".repeat(8_000));
    const bytes2 = await zip2.generateAsync({
      type: "uint8array",
      compression: "STORE",
    });
    const again = await loadSb3Isolated(
      bytes2,
      { maxUncompressedBytes: 100 },
      { timeoutMs: 15_000 },
    );
    expect(again.timedOut).toBe(false);
    expect(again.childExited).toBe(true);
    expect(again.ok).toBe(false);

    // Late double-resolve: give close handlers time; count must stay 1
    await new Promise((r) => setTimeout(r, 200));
    expect(resolveCount).toBe(1);
  }, 20_000);

  it("loads exported SB3 into vendor v14.1.0 VM and runs", async () => {
    const doc = sampleDoc();
    const bytes = await exportSb3(doc);
    const loaded = await loadSb3(bytes);
    expect(loaded.ok).toBe(true);
    const adapter = await createAdapter();
    expect(adapter.runtimeSource).toContain("14.1.0");
    await loadProjectJson(adapter, loaded.projectJson as Record<string, unknown>);
    const end = await adapter.runToEnd();
    expect(end.targets[0]?.x).toBeGreaterThan(0);
    adapter.dispose();
  });
});
