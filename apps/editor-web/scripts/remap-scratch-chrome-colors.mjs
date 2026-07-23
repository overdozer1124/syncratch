/**
 * Remap Scratch GUI "looks-secondary" purple chrome tokens to Syncratch blue.
 *
 * Scratch uses $looks-secondary (#855CD6 / hsla(260,…)) as the app chrome
 * accent (menus, modals, focus rings). The same hex is also Looks block
 * colourSecondary — those block-palette entries must stay purple.
 */

export const SYNCRATCH_CHROME_BLUE = "#1565a9";
export const SYNCRATCH_CHROME_BLUE_DARK = "#0f4d7a";
export const SYNCRATCH_CHROME_BLUE_HSLA = "hsla(208, 78%, 37%, 1)";
export const SYNCRATCH_CHROME_BLUE_DARK_HSLA = "hsla(205, 78%, 27%, 1)";

const LOOKS_BLOCK_SECONDARY_PLACEHOLDER =
  "__SYNCRATCH_PRESERVE_LOOKS_COLOUR_SECONDARY__";

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
