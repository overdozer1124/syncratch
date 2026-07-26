import {describe, expect, it, vi} from "vitest";
import {
  assertExtensionPrimitivesRegistered,
  ensureExtensionInToolbox,
  injectCategoryIntoToolboxXml,
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
    const defineBlocksWithJsonArray = vi.fn();
    const updateToolbox = vi.fn();
    const selectCategory = vi.fn(() => true);

    const ok = await ensureExtensionInToolbox({
      vm: {
        emit,
        runtime: {
          _blockInfo: [
            {
              id: "fetch",
              blocks: [
                {
                  json: {type: "fetch_get", message0: "GET"},
                  xml: '<block type="fetch_get"></block>',
                },
              ],
            },
          ],
          getBlocksXML: () => [{id: "fetch", xml: categoryXml}],
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
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({type: UPDATE_TOOLBOX_TYPE}),
    );
    expect(toolboxHasCategory(toolboxXML, "fetch")).toBe(true);
    expect(selectCategory).toHaveBeenCalledWith("fetch");
  });
});
