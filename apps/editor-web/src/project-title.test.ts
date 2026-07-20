import {describe, expect, it} from "vitest";
import {friendlyProjectTitle} from "./project-title.js";

describe("friendlyProjectTitle", () => {
  it("localizes legacy default titles without changing a child's own title", () => {
    expect(friendlyProjectTitle("Local project")).toBe("新しい作品");
    expect(friendlyProjectTitle("Drive project")).toBe(
      "Google ドライブの作品",
    );
    expect(friendlyProjectTitle("わたしのゲーム")).toBe("わたしのゲーム");
  });
});
