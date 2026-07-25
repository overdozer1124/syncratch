/**
 * ml5 is loaded at runtime from CDN before importing dependent extension modules.
 * See apps/editor-web/src/extension-gallery.ts ensureMl5Loaded().
 */
const g = typeof globalThis !== "undefined" ? globalThis : window;
const ml5 = g.ml5;
if (!ml5) {
  throw new Error(
    "ml5 is not loaded. Call ensureMl5Loaded() before importing this extension.",
  );
}
module.exports = ml5;
