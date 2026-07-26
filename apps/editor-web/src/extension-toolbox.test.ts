import {describe, expect, it, vi} from "vitest";
import {
  assertExtensionPrimitivesRegistered,
  ensureCategoryColors,
  ensureExtensionInToolbox,
  injectCategoryIntoToolboxXml,
  prepareExtensionBlockJson,
  readToolboxXml,
  toolboxHasCategory,
  UPDATE_TOOLBOX_TYPE,
} from "./extension-toolbox.js";

describe("extension toolbox helpers", () => {
  it("detects toolbox categories by toolboxitemid", () => {
    const xml = `<xml><category name="Fetch" toolboxitemid="fetch"></category></xml>`;
    expect(toolboxHasCategory(xml, "fetch")).toBe(true);
    expect(toolboxHasCategory(xml, "files")).toBe(false);
  });

  it("injects a category before </xml>", () => {
    const base = `<xml style="display: none">
<category name="Motion" toolboxitemid="motion"></category>
</xml>`;
    const category = `<category name="Fetch" toolboxitemid="fetch" colour="#0FBD8C"></category>`;
    const next = injectCategoryIntoToolboxXml(base, category);
    expect(toolboxHasCategory(next, "fetch")).toBe(true);
    expect(next.endsWith("</xml>") || next.trimEnd().endsWith("</xml>")).toBe(
      true,
    );
    expect(next.indexOf("fetch")).toBeLessThan(next.lastIndexOf("</xml>"));
  });

  it("reads toolbox XML from Scratch GUI redux state", () => {
    expect(
      readToolboxXml({
        scratchGui: {toolbox: {toolboxXML: "<xml></xml>"}},
      }),
    ).toBe("<xml></xml>");
    expect(readToolboxXml({})).toBeNull();
  });

  it("assertExtensionPrimitivesRegistered requires _blockInfo entry", () => {
    expect(() =>
      assertExtensionPrimitivesRegistered(
        {runtime: {_blockInfo: []}},
        "fetch",
      ),
    ).toThrow(/fetch/);
    expect(() =>
      assertExtensionPrimitivesRegistered(
        {runtime: {_blockInfo: [{id: "fetch", blocks: []}]}},
        "fetch",
      ),
    ).not.toThrow();
  });

  it("ensureCategoryColors fills missing color2/color3 in place", () => {
    const category = {id: "text", color1: "#9966FF"} as {
      id: string;
      color1?: string;
      color2?: string;
      color3?: string;
    };
    const filled = ensureCategoryColors(category);
    expect(filled.color1).toBe("#9966FF");
    expect(filled.color2).toBe("#9966FF");
    expect(filled.color3).toBe("#9966FF");
    expect(category.color2).toBe("#9966FF");
  });

  it("prepareExtensionBlockJson strips unknown extensions and keeps style without colours", () => {
    const prepared = prepareExtensionBlockJson(
      {
        type: "text_setText",
        style: "text",
        colour: "#9966FF",
        colourSecondary: "#774DCB",
        colourTertiary: "#5484D7",
        extensions: ["scratch_extension", "colours_looks", "shape_hat"],
        message0: "%1 hello",
      },
      {color1: "#9966FF", color2: "#774DCB", color3: "#5484D7"},
    );
    expect(prepared.extensions).toEqual(["scratch_extension", "shape_hat"]);
    expect(prepared.style).toBe("text");
    // Blockly forbids colour + style together ("Must not have both…").
    expect(prepared.colour).toBeUndefined();
    expect(prepared.colourSecondary).toBeUndefined();
    expect(prepared.colourTertiary).toBeUndefined();
  });

  it("prepareExtensionBlockJson adds colours when style is absent", () => {
    const prepared = prepareExtensionBlockJson(
      {
        type: "fetch_get",
        extensions: ["scratch_extension"],
        message0: "GET",
      },
      {color1: "#0FBD8C", color2: "#0DA57A", color3: "#0B8E69"},
    );
    expect(prepared.colour).toBe("#0FBD8C");
    expect(prepared.colourSecondary).toBe("#0DA57A");
    expect(prepared.colourTertiary).toBe("#0B8E69");
  });

  it("ensureExtensionInToolbox injects XML when GUI listener skips refresh", async () => {
    const categoryXml =
      '<category name="Fetch" toolboxitemid="fetch" colour="#0FBD8C"><block type="fetch_get"></block></category>';
    let toolboxXML =
      '<xml style="display: none"><category name="Motion" toolboxitemid="motion"></category></xml>';
    const store = {
      getState: () => ({scratchGui: {toolbox: {toolboxXML}}}),
      dispatch: vi.fn((action: {type?: string; toolboxXML?: string}) => {
        if (
          action?.type === UPDATE_TOOLBOX_TYPE &&
          typeof action.toolboxXML === "string"
        ) {
          toolboxXML = action.toolboxXML;
        }
      }),
    };
    const emit = vi.fn();
    const emitWorkspaceUpdate = vi.fn();
    const defineBlocksWithJsonArray = vi.fn();
    const updateToolbox = vi.fn();
    const selectCategory = vi.fn(() => true);

    const ok = await ensureExtensionInToolbox({
      vm: {
        emit,
        emitWorkspaceUpdate,
        runtime: {
          _blockInfo: [
            {
              id: "fetch",
              color1: "#0FBD8C",
              color2: "#0DA57A",
              color3: "#0B8E69",
              blocks: [
                {
                  json: {type: "fetch_get", message0: "GET"},
                  xml: '<block type="fetch_get"></block>',
                },
              ],
            },
          ],
          getBlocksXML: () => [{id: "fetch", xml: categoryXml}],
          targets: [],
        },
      },
      store,
      extensionId: "fetch",
      scratchBlocks: {
        defineBlocksWithJsonArray,
        getMainWorkspace: () => ({updateToolbox}),
      },
      selectCategory,
      attempts: 2,
      delayMs: 0,
      sleep: async () => undefined,
    });

    expect(ok).toBe(true);
    expect(emit).toHaveBeenCalledWith(
      "EXTENSION_ADDED",
      expect.objectContaining({id: "fetch"}),
    );
    expect(defineBlocksWithJsonArray).toHaveBeenCalled();
    const defined = defineBlocksWithJsonArray.mock.calls[0]?.[0] as Array<{
      colour?: string;
      type?: string;
    }>;
    expect(defined[0]?.type).toBe("fetch_get");
    expect(defined[0]?.colour).toBeTruthy();
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({type: UPDATE_TOOLBOX_TYPE}),
    );
    expect(toolboxHasCategory(toolboxXML, "fetch")).toBe(true);
    // Must not jump the continuous flyout to the new (possibly empty) category.
    expect(selectCategory).not.toHaveBeenCalled();
    // Must not call workspace.updateToolbox directly (races stock GUI).
    expect(updateToolbox).not.toHaveBeenCalled();
    // Fresh add with no placed blocks must not rebuild the workspace.
    expect(emitWorkspaceUpdate).not.toHaveBeenCalled();
  });

  it("does not replace an empty toolbox with only the extension category", async () => {
    let toolboxXML = "";
    const store = {
      getState: () => ({scratchGui: {toolbox: {toolboxXML}}}),
      dispatch: vi.fn((action: {type?: string; toolboxXML?: string}) => {
        if (
          action?.type === UPDATE_TOOLBOX_TYPE &&
          typeof action.toolboxXML === "string"
        ) {
          toolboxXML = action.toolboxXML;
        }
      }),
    };
    const ok = await ensureExtensionInToolbox({
      vm: {
        runtime: {
          _blockInfo: [{id: "fetch", blocks: []}],
          getBlocksXML: () => [
            {
              id: "fetch",
              xml: '<category name="Fetch" toolboxitemid="fetch"></category>',
            },
          ],
        },
      },
      store,
      extensionId: "fetch",
      attempts: 1,
      delayMs: 0,
      sleep: async () => undefined,
    });
    expect(ok).toBe(false);
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(toolboxXML).toBe("");
  });
});
