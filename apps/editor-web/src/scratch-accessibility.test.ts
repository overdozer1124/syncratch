import {describe, expect, it} from "vitest";
import {japaneseScratchLabel} from "./scratch-accessibility.js";

describe("japaneseScratchLabel", () => {
  it("localizes built-in Scratch accessibility labels", () => {
    expect(japaneseScratchLabel("Settings menu")).toBe("設定メニュー");
    expect(japaneseScratchLabel("Start project")).toBe("作品を動かす");
    expect(japaneseScratchLabel("Delete")).toBe("削除");
    expect(japaneseScratchLabel("Sprite1")).toBe("Sprite1");
  });
});
