import {describe, expect, it} from "vitest";
import {
  defaultExtensionCatalog,
  defaultProjectExtensionIds,
  prefixOpcodeExtensionIdSet,
} from "./default-extensions.js";
import {allowedExtensionIdSet} from "./scratch-opcodes.js";

describe("default extensions catalog (Stretch3 / Xcratch)", () => {
  it("includes Scratch soft extensions and Stretch3 custom ids", () => {
    const ids = new Set(defaultProjectExtensionIds());
    for (const id of [
      "music",
      "pen",
      "makeymakey",
      "wedo2",
      "ml2scratch",
      "speech2scratch",
      "chatgpt2scratch",
      "g2s",
      "gai",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("keeps Xcratch Extension Loader as UI-only (no project.extensions id)", () => {
    const loader = defaultExtensionCatalog.extensions.find(
      (entry) => entry.catalogId === "extensionLoader",
    );
    expect(loader).toBeDefined();
    expect(loader?.extensionId).toBeNull();
    expect(loader?.kind).toBe("loader");
    expect(defaultProjectExtensionIds()).not.toContain("extensionLoader");
  });

  it("matches scratch-opcodes allowedExtensionIds", () => {
    expect([...allowedExtensionIdSet()].sort()).toEqual(
      [...defaultProjectExtensionIds()].sort(),
    );
  });

  it("marks hardware and external extensions as prefix opcode policy", () => {
    const prefix = prefixOpcodeExtensionIdSet();
    expect(prefix.has("wedo2")).toBe(true);
    expect(prefix.has("ml2scratch")).toBe(true);
    expect(prefix.has("music")).toBe(false);
  });
});
