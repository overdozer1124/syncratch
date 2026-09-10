import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {loadSb3} from "./index.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../test/fixtures/chat-wo-tsukurou.sb3",
);

describe("classroom SB3 with stage list monitor", () => {
  it("imports チャットを作ろう！.sb3 (monitors normalized away)", async () => {
    const result = await loadSb3(readFileSync(fixture));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.document?.extensions).toContain("g2s");
    expect(result.document?.monitors).toEqual([]);
    const stage = result.document?.targets.find(t => t.isStage);
    const lists = Object.values(stage?.lists ?? {});
    expect(lists.some(list => list[0] === "チャット")).toBe(true);
  }, 60000);
});
