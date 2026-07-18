import { DOMParser } from "@xmldom/xmldom";
import { parse, walk } from "css-tree";

export class SvgSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SvgSafetyError";
  }
}

export const SVG_MAX_BYTES = 512 * 1024;
export const SVG_MAX_NODES = 65_536;
export const SVG_MAX_DEPTH = 256;

const DISALLOWED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "embed",
  "object",
  "frame",
  "applet",
]);

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "title",
  "desc",
  "metadata",
  "style",
]);

const GLOBAL_ATTRIBUTES = new Set([
  "id",
  "class",
  "style",
  "transform",
  "opacity",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "fill-opacity",
  "fill-rule",
  "stroke-opacity",
  "enable-background",
  "alignment-baseline",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "visibility",
  "display",
  "xmlns",
  "xmlns:xlink",
  "xml:space",
]);

const ELEMENT_ATTRIBUTES: Record<string, Set<string>> = {
  svg: new Set(["width", "height", "viewBox", "version", "preserveAspectRatio", "x", "y"]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry"]),
  circle: new Set(["cx", "cy", "r"]),
  ellipse: new Set(["cx", "cy", "rx", "ry"]),
  line: new Set(["x1", "y1", "x2", "y2"]),
  polyline: new Set(["points"]),
  polygon: new Set(["points"]),
  path: new Set(["d"]),
  text: new Set([
    "x",
    "y",
    "dx",
    "dy",
    "rotate",
    "textLength",
    "lengthAdjust",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "dominant-baseline",
  ]),
  tspan: new Set(["x", "y", "dx", "dy"]),
  use: new Set(["href", "xlink:href", "x", "y", "width", "height"]),
  lineargradient: new Set([
    "x1",
    "y1",
    "x2",
    "y2",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
  ]),
  radialgradient: new Set([
    "cx",
    "cy",
    "r",
    "fx",
    "fy",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
  ]),
  stop: new Set(["offset", "stop-color", "stop-opacity"]),
};

const URI_ATTRIBUTES = new Set(["href", "xlink:href"]);

function isInternalRef(ref: string): boolean {
  const trimmed = ref.trim();
  return trimmed.startsWith("#");
}

function rawTextHasExternalUrls(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s/g, "");
  const urlPattern = /url\((.+?)\)/g;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(normalized)) !== null) {
    const ref = match[1]!.replace(/['"]/g, "");
    if (!isInternalRef(ref)) return true;
  }
  return false;
}

function astHasExternalUrls(ast: ReturnType<typeof parse>): boolean {
  let found = false;
  walk(ast, (node) => {
    if (node.type === "Url") {
      const urlValue = String(node.value).trim().replace(/['"]/g, "");
      if (!isInternalRef(urlValue)) found = true;
    }
    if (node.type === "Raw" && rawTextHasExternalUrls(String(node.value))) {
      found = true;
    }
    if (node.type === "Atrule" && node.name?.toLowerCase() === "import") {
      found = true;
    }
  });
  return found;
}

function cssHasExternalUrls(cssText: string, parseContext: string): boolean {
  try {
    return astHasExternalUrls(parse(cssText, { context: parseContext }));
  } catch {
    return rawTextHasExternalUrls(cssText);
  }
}

function assertAllowedAttribute(tag: string, name: string): void {
  const lowerName = name.toLowerCase();
  if (/^data-[a-z0-9-]+$/i.test(name)) return;
  if (GLOBAL_ATTRIBUTES.has(name) || GLOBAL_ATTRIBUTES.has(lowerName)) return;
  const allowed = ELEMENT_ATTRIBUTES[tag];
  if (allowed?.has(name) || allowed?.has(lowerName)) return;
  throw new SvgSafetyError(`UNKNOWN_ATTR:${name}`);
}

function assertSafeUriAttribute(name: string, value: string): void {
  const trimmed = value.replace(/\s/g, "");
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("data:")
  ) {
    throw new SvgSafetyError(`DISALLOWED_URI:${name}`);
  }
  if (!isInternalRef(trimmed)) {
    throw new SvgSafetyError(`EXTERNAL_URI:${name}`);
  }
}

function assertSafeCssAttribute(name: string, value: string): void {
  const context = name === "style" ? "declarationList" : "value";
  if (cssHasExternalUrls(value, context)) {
    throw new SvgSafetyError(`EXTERNAL_CSS_URL:${name}`);
  }
}

function assertSafeNode(node: Node): void {
  if (node.nodeType === 10) {
    throw new SvgSafetyError("DOCTYPE");
  }
  if (node.nodeType === 7) {
    throw new SvgSafetyError("PROCESSING_INSTRUCTION");
  }
  if (node.nodeType !== 1) {
    return;
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DISALLOWED_ELEMENTS.has(tag)) {
    throw new SvgSafetyError(`DISALLOWED_ELEMENT:${tag}`);
  }
  if (!ALLOWED_ELEMENTS.has(tag)) {
    throw new SvgSafetyError(`UNKNOWN_ELEMENT:${tag}`);
  }

  if (tag === "use") {
    const href = el.getAttribute("href") ?? el.getAttribute("xlink:href");
    if (href && !isInternalRef(href)) {
      throw new SvgSafetyError("EXTERNAL_USE");
    }
  }

  if (el.attributes) {
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes.item(i);
      if (!attr) continue;
      const name = attr.name;
      const value = attr.value;
      assertAllowedAttribute(tag, name);
      if (/^on/i.test(name)) {
        throw new SvgSafetyError(`EVENT_ATTR:${name}`);
      }
      if (URI_ATTRIBUTES.has(name)) {
        assertSafeUriAttribute(name, value);
      } else if (name === "style" || /^fill$|^stroke$|^filter$/i.test(name)) {
        assertSafeCssAttribute(name, value);
      }
    }
  }

  if (tag === "style" && el.textContent) {
    if (cssHasExternalUrls(el.textContent, "stylesheet")) {
      throw new SvgSafetyError("STYLE_EXTERNAL");
    }
    try {
      walk(parse(el.textContent, { context: "stylesheet" }), (astNode, item, list) => {
        if (astNode.type === "Atrule" && astNode.name?.toLowerCase() === "import") {
          list.remove(item);
          throw new SvgSafetyError("CSS_IMPORT");
        }
      });
    } catch (e) {
      if (e instanceof SvgSafetyError) throw e;
      if (rawTextHasExternalUrls(el.textContent)) {
        throw new SvgSafetyError("STYLE_UNPARSEABLE");
      }
    }
  }

}

function walkNodes(root: Node): void {
  const stack: Array<{node: Node; depth: number}> = [{node: root, depth: 0}];
  let nodeCount = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodeCount += 1;
    if (nodeCount > SVG_MAX_NODES) {
      throw new SvgSafetyError("NODE_LIMIT");
    }
    if (current.depth > SVG_MAX_DEPTH) {
      throw new SvgSafetyError("DEPTH_LIMIT");
    }
    assertSafeNode(current.node);
    for (
      let child = current.node.lastChild;
      child;
      child = child.previousSibling
    ) {
      stack.push({node: child, depth: current.depth + 1});
    }
  }
}

/** Parse SVG and walk DOM with explicit allow-list (Design §7). */
export function assertSafeSvgBytes(bytes: Uint8Array): void {
  if (bytes.byteLength > SVG_MAX_BYTES) {
    throw new SvgSafetyError("TOO_LARGE");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    throw new SvgSafetyError("DOCTYPE_OR_ENTITY");
  }

  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    throw new SvgSafetyError("NOT_SVG");
  }

  walkNodes(doc);
}
