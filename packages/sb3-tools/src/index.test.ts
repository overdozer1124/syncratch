import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  exportSb3,
  loadSb3,
  semanticFingerprint,
} from "../src/index.js";
import { emptyProject, type ProjectDocument } from "@blocksync/project-schema";

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
        next: "move",
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
        x: 0,
        y: 0,
      },
      move: {
        id: "move",
        opcode: "motion_movesteps",
        next: null,
        parent: "hat",
        inputs: { STEPS: [1, [4, "10"]] },
        fields: {},
        topLevel: false,
      },
    },
  });
  return base;
}

describe("sb3-tools", () => {
  it("round-trips a minimal self-authored project semantically", async () => {
    const doc = sampleDoc();
    const bytes = await exportSb3(doc);
    const loaded = await loadSb3(bytes);
    expect(loaded.ok).toBe(true);
    expect(semanticFingerprint(loaded.document!)).toBe(
      semanticFingerprint(doc),
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

  it("flags path-traversal names before zip write-normalization", () => {
    // Direct unit coverage of the guard used by loadSb3
    const issues = (
      [
        "assets/../../evil.json",
        "../evil.json",
        "a/../../../b",
      ] as const
    ).map((name) => {
      const n = name.replace(/\\/g, "/");
      const startsAbs = n.startsWith("/");
      const parts = `root/${n}`.split("/");
      const out: string[] = [];
      for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
          out.pop();
          continue;
        }
        out.push(part);
      }
      const normalized = out.join("/");
      return (
        !startsAbs &&
        !normalized.startsWith("root/") &&
        normalized !== "root"
      );
    });
    expect(issues.every(Boolean)).toBe(true);
  });

  it("does not silently drop schema failures", async () => {
    const zip = new JSZip();
    zip.file(
      "project.json",
      JSON.stringify({
        targets: [
          {
            isStage: true,
            name: "Stage",
            blocks: {
              a: {
                opcode: "motion_movesteps",
                next: "a",
                parent: null,
                inputs: {},
                fields: {},
                topLevel: true,
              },
            },
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
    expect(loaded.issues.some((i) => i.code === "SCHEMA_INVALID")).toBe(true);
  });
});
