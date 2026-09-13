import {beforeEach, describe, expect, it} from "vitest";
import {
  clearWorkspaceVmDesyncLog,
  getWorkspaceVmDesyncLog,
  hashBlockGraphEdges,
  hashBlocklyWorkspaceEdges,
  hashVmVisibleBlockGraph,
  recordWorkspaceVmDesync,
} from "./workspace-desync-diagnostics.js";

describe("workspace-desync-diagnostics", () => {
  beforeEach(() => {
    clearWorkspaceVmDesyncLog();
  });

  it("hashes block parent/next/input edges", () => {
    const blocks = {
      hat: {parent: null, next: "body", inputs: {}},
      body: {
        parent: "hat",
        next: null,
        inputs: {SUBSTACK: {block: "move", shadow: null}},
      },
      move: {
        parent: "body",
        next: null,
        inputs: {STEPS: {block: "steps", shadow: "steps"}},
      },
    };
    expect(hashBlockGraphEdges(blocks, ["hat", "body", "move"])).toBe(
      "body:hat::SUBSTACK:move:|hat::body:|move:body::STEPS:steps:steps",
    );
  });

  it("hashBlocklyWorkspaceEdges captures parent/next/input connections", () => {
    const connected = hashBlocklyWorkspaceEdges({
      getAllBlocks: () => [
        {
          id: "hat",
          isShadow: () => false,
          getParent: () => null,
          getNextBlock: () => ({id: "body"}),
          inputList: [],
        },
        {
          id: "body",
          isShadow: () => false,
          getParent: () => ({id: "hat"}),
          getNextBlock: () => null,
          inputList: [
            {
              name: "SUBSTACK",
              connection: {targetBlock: () => ({id: "move"})},
            },
          ],
        },
        {
          id: "move",
          isShadow: () => false,
          getParent: () => ({id: "body"}),
          getNextBlock: () => null,
          inputList: [],
        },
      ],
    });

    const disconnected = hashBlocklyWorkspaceEdges({
      getAllBlocks: () => [
        {
          id: "hat",
          isShadow: () => false,
          getParent: () => null,
          getNextBlock: () => null,
          inputList: [],
        },
        {
          id: "body",
          isShadow: () => false,
          getParent: () => null,
          getNextBlock: () => null,
          inputList: [],
        },
        {
          id: "move",
          isShadow: () => false,
          getParent: () => null,
          getNextBlock: () => null,
          inputList: [],
        },
      ],
    });

    expect(connected).not.toBe(disconnected);
  });

  it("visible VM graph ignores shadow blocks and shadow-only inputs", () => {
    const vmBlocks = {
      hat: {parent: null, next: "move", shadow: false, inputs: {}},
      move: {
        parent: "hat",
        next: null,
        shadow: false,
        inputs: {STEPS: {block: "steps", shadow: "steps"}},
      },
      steps: {parent: "move", next: null, shadow: true, inputs: {}},
    };
    const blockly = hashBlocklyWorkspaceEdges({
      getAllBlocks: () => [
        {
          id: "hat",
          isShadow: () => false,
          getParent: () => null,
          getNextBlock: () => ({id: "move"}),
          inputList: [],
        },
        {
          id: "move",
          isShadow: () => false,
          getParent: () => ({id: "hat"}),
          getNextBlock: () => null,
          inputList: [
            {
              name: "STEPS",
              connection: {
                targetBlock: () => ({id: "steps", isShadow: () => true}),
              },
            },
          ],
        },
        {
          id: "steps",
          isShadow: () => true,
          getParent: () => ({id: "move"}),
          getNextBlock: () => null,
          inputList: [],
        },
      ],
    });
    expect(hashVmVisibleBlockGraph(vmBlocks)).toBe(blockly);
  });

  it("suppresses duplicate signatures and increments repeatCount", () => {
    const payload = {
      workspaceTopBlocks: 0,
      vmScriptCount: 1,
      vmBlockIds: ["a"],
      vmEdgeHash: "vm",
      blocklyTopBlockIds: [],
      blocklyEdgeHash: "0",
      threads: [],
      action: "detected" as const,
    };
    const first = recordWorkspaceVmDesync(payload);
    const second = recordWorkspaceVmDesync(payload);
    expect(getWorkspaceVmDesyncLog()).toHaveLength(1);
    expect(second).toBe(first);
    expect(second.repeatCount).toBe(2);
  });

  it("keeps a bounded ring buffer", () => {
    for (let i = 0; i < 55; i += 1) {
      recordWorkspaceVmDesync({
        workspaceTopBlocks: 0,
        vmScriptCount: 1,
        vmBlockIds: ["a"],
        vmEdgeHash: `vm-${i}`,
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
