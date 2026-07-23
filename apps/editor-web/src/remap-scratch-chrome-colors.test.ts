import {describe, expect, it} from "vitest";
import {
  SYNCRATCH_CHROME_BLUE,
  SYNCRATCH_CHROME_BLUE_DARK,
  SYNCRATCH_CHROME_BLUE_HSLA,
  remapScratchChromePurpleToBlue,
} from "../scripts/remap-scratch-chrome-colors.mjs";

describe("remapScratchChromePurpleToBlue", () => {
  it("recolors chrome hsla and hex tokens to Syncratch blue", () => {
    const input = [
      "background: hsla(260, 60%, 60%, 1);",
      "box-shadow: 0 0 0 .25rem hsla(260, 60%, 60%, 0.35);",
      "outline: hsla(260, 60%, 60%, 0.15);",
      "border-color: hsla(260, 42%, 51%, 1);",
      "color: #855CD6;",
      "background: #714EB6;",
      "fill: rgba(133, 92, 214, 0.5);",
    ].join("\n");

    const out = remapScratchChromePurpleToBlue(input);

    expect(out).toContain(SYNCRATCH_CHROME_BLUE_HSLA);
    expect(out).toContain("hsla(208, 78%, 37%, 0.35)");
    expect(out).toContain("hsla(208, 78%, 37%, 0.15)");
    expect(out).toContain(SYNCRATCH_CHROME_BLUE);
    expect(out).toContain(SYNCRATCH_CHROME_BLUE_DARK);
    expect(out).toContain("rgba(21, 101, 169, 0.5)");
    expect(out).not.toContain("hsla(260,");
    expect(out).not.toMatch(/#855[Cc][Dd]6/);
    expect(out).not.toMatch(/#714[Ee][Bb]6/);
  });

  it("keeps Looks block colourSecondary purple", () => {
    const input =
      'looks:{colourPrimary:"#9966FF",colourSecondary:"#855CD6",colourTertiary:"#774DCB"}';
    const out = remapScratchChromePurpleToBlue(input);
    expect(out).toContain('colourSecondary:"#855CD6"');
    expect(out).toContain('colourPrimary:"#9966FF"');
  });

  it("still remaps chrome hex next to preserved block colours", () => {
    const input =
      'looks:{colourSecondary:"#855CD6"};.menu{background:#855CD6}';
    const out = remapScratchChromePurpleToBlue(input);
    expect(out).toContain('colourSecondary:"#855CD6"');
    expect(out).toContain(`.menu{background:${SYNCRATCH_CHROME_BLUE}}`);
  });
});
