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
      64,
    );
    expect(loaded.ok).toBe(false);
    expect(loaded.issues.some((i) => i.code === "TOO_LARGE")).toBe(true);
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
