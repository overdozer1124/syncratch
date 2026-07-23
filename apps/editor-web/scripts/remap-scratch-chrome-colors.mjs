/**
 * Remap Scratch GUI "looks-secondary" purple chrome tokens to Syncratch blue.
 *
 * Scratch uses $looks-secondary (#855CD6 / hsla(260,…)) as the app chrome
 * accent (menus, modals, focus rings, toolbar icons). The same hex is also Looks
 * block colourSecondary — those block-palette entries must stay purple.
 *
 * Many chrome icons are webpack-inlined as `data:image/svg+xml;base64,…`, so
 * plain-text hex replacement misses them. This remapper also decodes those
 * SVGs, recolors chrome purple fills/strokes, and re-encodes.
 */

export const SYNCRATCH_CHROME_BLUE = "#1565a9";
export const SYNCRATCH_CHROME_BLUE_DARK = "#0f4d7a";
export const SYNCRATCH_CHROME_BLUE_HSLA = "hsla(208, 78%, 37%, 1)";
export const SYNCRATCH_CHROME_BLUE_DARK_HSLA = "hsla(205, 78%, 27%, 1)";

const LOOKS_BLOCK_SECONDARY_PLACEHOLDER =
  "__SYNCRATCH_PRESERVE_LOOKS_COLOUR_SECONDARY__";

/**
 * Recolor Scratch chrome purple hex tokens inside SVG markup.
 * @param {string} svg
 * @returns {string}
 */
export function remapPurpleHexInSvg(svg) {
  return svg
    .replace(/#855[Cc][Dd]633\b/g, `${SYNCRATCH_CHROME_BLUE}33`)
    .replace(/#855[Cc][Dd]6\b/g, SYNCRATCH_CHROME_BLUE)
    .replace(/#714[Ee][Bb]6\b/g, SYNCRATCH_CHROME_BLUE_DARK)
    // Icon stroke / shadow variants of looks-secondary.
    .replace(/#6736[Bb]5\b/g, SYNCRATCH_CHROME_BLUE_DARK)
    .replace(/#6035[Bb]4\b/g, SYNCRATCH_CHROME_BLUE_DARK);
}

/**
 * @param {string} source
 * @returns {string}
 */
function remapBase64SvgDataUris(source) {
  return source.replace(
    /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g,
    (match, b64) => {
      let svg;
      try {
        svg = Buffer.from(b64, "base64").toString("utf8");
      } catch {
        return match;
      }
      if (!/#(?:855|714[Ee][Bb]6|6736|6035)/i.test(svg)) {
        return match;
      }
      const remapped = remapPurpleHexInSvg(svg);
      if (remapped === svg) {
        return match;
      }
      return `data:image/svg+xml;base64,${Buffer.from(remapped, "utf8").toString("base64")}`;
    },
  );
}

/**
 * @param {string} source
 * @returns {string}
 */
export function remapScratchChromePurpleToBlue(source) {
  let text = source;

  // Preserve Looks category block colours (Blockly colourSecondary hex).
  text = text.replaceAll(
    'colourSecondary:"#855CD6"',
    `colourSecondary:"${LOOKS_BLOCK_SECONDARY_PLACEHOLDER}"`,
  );
  text = text.replaceAll(
    "colourSecondary:'#855CD6'",
    `colourSecondary:'${LOOKS_BLOCK_SECONDARY_PLACEHOLDER}'`,
  );

  // Inlined SVG icons (tabs, delete prompt, paint tools, direction dial, …).
  text = remapBase64SvgDataUris(text);

  // CSS $looks-* tokens compile to these hsla() forms.
  text = text.replaceAll(
    "hsla(260, 60%, 60%, 1)",
    SYNCRATCH_CHROME_BLUE_HSLA,
  );
  text = text.replaceAll(
    "hsla(260, 60%, 60%, 0.35)",
    "hsla(208, 78%, 37%, 0.35)",
  );
  text = text.replaceAll(
    "hsla(260, 60%, 60%, 0.15)",
    "hsla(208, 78%, 37%, 0.15)",
  );
  text = text.replaceAll(
    "hsla(260, 42%, 51%, 1)",
    SYNCRATCH_CHROME_BLUE_DARK_HSLA,
  );

  // Compiled hex / rgb forms used in chrome CSS (not Looks block primary).
  text = text.replace(/#855[Cc][Dd]6/g, SYNCRATCH_CHROME_BLUE);
  text = text.replace(/#714[Ee][Bb]6/g, SYNCRATCH_CHROME_BLUE_DARK);
  text = text.replace(
    /rgba\(\s*133\s*,\s*92\s*,\s*214/g,
    "rgba(21, 101, 169",
  );
  text = text.replace(/rgb\(\s*133\s*,\s*92\s*,\s*214\s*\)/g, "rgb(21, 101, 169)");

  text = text.replaceAll(
    LOOKS_BLOCK_SECONDARY_PLACEHOLDER,
    "#855CD6",
  );

  return text;
}
