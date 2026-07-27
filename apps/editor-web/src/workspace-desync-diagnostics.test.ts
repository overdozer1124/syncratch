import {beforeEach, describe, expect, it} from "vitest";
import {hashBlockEdges, recordWorkspaceVmDesync, clearWorkspaceVmDesyncLog, getWorkspaceVmDesyncLog} from "./workspace-desync-diagnostics.js";

describe("workspace-desync-diagnostics", () => {
  beforeEach(() => {
    clearWorkspaceVmDesyncLog();
  });

  it("hashes block parent/next edges", () => {
    const blocks = {
      hat: {parent: null, next: "body"},
      body: {parent: "hat", next: null},
    };
    expect(hashBlockEdges(blocks, ["hat", "body"])).toBe("body:hat:|hat::body");
  });

  it("keeps a bounded ring buffer", () => {
    for (let i = 0; i < 55; i += 1) {
      recordWorkspaceVmDesync({
        workspaceTopBlocks: 0,
        vmScriptCount: 1,
        vmBlockIds: ["a"],
        vmEdgeHash: "0",
        blocklyTopBlockIds: [],
        blocklyEdgeHash: "",
        threads: [],
        action: "detected",
      });
    }
    expect(getWorkspaceVmDesyncLog()).toHaveLength(50);
    expect(getWorkspaceVmDesyncLog()[0]?.seq).toBe(6);
  });
});
