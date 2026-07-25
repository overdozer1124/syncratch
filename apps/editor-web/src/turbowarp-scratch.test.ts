import {afterEach, describe, expect, it} from "vitest";
import {
  createTurbowarpScratch,
  isTurbowarpScriptUrl,
  loadTurbowarpExtensionScript,
  resetTurbowarpLoadQueueForTests,
  setTurbowarpScriptFetcherForTests,
  TurbowarpCast,
} from "./turbowarp-scratch.js";

describe("turbowarp scratch helpers", () => {
  afterEach(() => {
    resetTurbowarpLoadQueueForTests();
    setTurbowarpScriptFetcherForTests(null);
    delete (globalThis as {Scratch?: unknown}).Scratch;
  });

  it("detects TurboWarp classic script URLs", () => {
    expect(isTurbowarpScriptUrl("https://extensions.turbowarp.org/fetch.js")).toBe(
      true,
    );
    expect(
      isTurbowarpScriptUrl("https://example.com/ext.mjs"),
    ).toBe(false);
    expect(isTurbowarpScriptUrl("extensions/foo.mjs")).toBe(false);
  });

  it("casts Scratch values like the VM Cast helper", () => {
    expect(TurbowarpCast.toNumber("12")).toBe(12);
    expect(TurbowarpCast.toNumber("nope")).toBe(0);
    expect(TurbowarpCast.toBoolean("false")).toBe(false);
    expect(TurbowarpCast.toBoolean("yes")).toBe(true);
    expect(TurbowarpCast.compare("a", "B")).toBeLessThan(0);
  });

  it("registers extensions through the Scratch.extensions API", async () => {
    const vm = {runtime: {renderer: null}};
    const source = `Scratch.translate.setup({});
(function (Scratch) {
  "use strict";
  if (!Scratch.extensions.unsandboxed) throw new Error("sandboxed");
  class Demo {
    getInfo() { return { id: "fetch", name: "Fetch", blocks: [] }; }
  }
  Scratch.extensions.register(new Demo());
})(Scratch);`;
    setTurbowarpScriptFetcherForTests(async () => source);
    const objects = await loadTurbowarpExtensionScript(
      vm,
      "https://extensions.turbowarp.org/fetch.js",
    );
    expect(objects).toHaveLength(1);
    expect(objects[0]!.getInfo().id).toBe("fetch");
  });

  it("exposes translate.setup before the extension IIFE runs", () => {
    const registered: unknown[] = [];
    const Scratch = createTurbowarpScratch(
      {runtime: {}, getLocale: () => "ja"},
      obj => {
        registered.push(obj);
      },
    );
    Scratch.translate.setup({
      ja: {_Fetch: "フェッチ"},
    });
    expect(Scratch.translate("Fetch")).toBe("フェッチ");
    Scratch.extensions.register({
      getInfo: () => ({id: "fetch"}),
    });
    expect(registered).toHaveLength(1);
  });
});
