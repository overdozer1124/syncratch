/**
 * Minimal TurboWarp unsandboxed `Scratch` API for classic-script extensions.
 *
 * TurboWarp extensions ship as `(function (Scratch) { ... })(Scratch)` scripts
 * that call `Scratch.extensions.register(...)`. Syncratch does not ship the
 * TurboWarp VM runner, so we inject a compatible global before loading.
 */

import {
  ensureTurbowarpVmCompat,
  type CompatVm,
} from "./turbowarp-vm-compat.js";

export type TurbowarpExtensionObject = {
  getInfo(): {id: string; name?: string; blocks?: unknown[]};
};

export type TurbowarpVm = {
  runtime?: unknown;
  renderer?: unknown;
  getLocale?: () => string;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
};

const ArgumentType = {
  ANGLE: "angle",
  BOOLEAN: "Boolean",
  COLOR: "color",
  NUMBER: "number",
  STRING: "string",
  MATRIX: "matrix",
  NOTE: "note",
  IMAGE: "image",
} as const;

const BlockType = {
  BOOLEAN: "Boolean",
  BUTTON: "button",
  /** TurboWarp: non-block text label in the palette. */
  LABEL: "label",
  COMMAND: "command",
  CONDITIONAL: "conditional",
  EVENT: "event",
  HAT: "hat",
  LOOP: "loop",
  REPORTER: "reporter",
  /** TurboWarp: raw scratch-blocks XML entry. */
  XML: "xml",
} as const;

const TargetType = {
  SPRITE: "sprite",
  STAGE: "stage",
} as const;

const BlockShape = {
  HEXAGONAL: 1,
  ROUND: 2,
  SQUARE: 3,
} as const;

/** Enough of Scratch Cast for TurboWarp gallery extensions. */
export class TurbowarpCast {
  static toNumber(value: unknown): number {
    if (typeof value === "number") {
      return Number.isNaN(value) ? 0 : value;
    }
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  }

  static toBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value === "" || value === "0" || value.toLowerCase() === "false") {
        return false;
      }
      return true;
    }
    return Boolean(value);
  }

  static toString(value: unknown): string {
    return String(value);
  }

  static isWhiteSpace(val: unknown): boolean {
    return val === null || (typeof val === "string" && val.trim().length === 0);
  }

  static compare(v1: unknown, v2: unknown): number {
    let n1 = Number(v1);
    let n2 = Number(v2);
    if (n1 === 0 && TurbowarpCast.isWhiteSpace(v1)) n1 = NaN;
    else if (n2 === 0 && TurbowarpCast.isWhiteSpace(v2)) n2 = NaN;
    if (Number.isNaN(n1) || Number.isNaN(n2)) {
      const s1 = String(v1).toLowerCase();
      const s2 = String(v2).toLowerCase();
      if (s1 < s2) return -1;
      if (s1 > s2) return 1;
      return 0;
    }
    if (
      (n1 === Infinity && n2 === Infinity) ||
      (n1 === -Infinity && n2 === -Infinity)
    ) {
      return 0;
    }
    return n1 - n2;
  }

  static isInt(val: unknown): boolean {
    if (typeof val === "number") {
      if (Number.isNaN(val)) return true;
      return val === parseInt(String(val), 10);
    }
    if (typeof val === "boolean") return true;
    if (typeof val === "string") return val.indexOf(".") < 0;
    return false;
  }

  static get LIST_INVALID(): string {
    return "INVALID";
  }

  static get LIST_ALL(): string {
    return "ALL";
  }

  static toListIndex(
    index: unknown,
    length: number,
    acceptAll: boolean,
  ): number | string {
    if (typeof index !== "number") {
      if (index === "all") {
        return acceptAll ? TurbowarpCast.LIST_ALL : TurbowarpCast.LIST_INVALID;
      }
      if (index === "last") {
        return length > 0 ? length : TurbowarpCast.LIST_INVALID;
      }
      if (index === "random" || index === "any") {
        return length > 0
          ? 1 + Math.floor(Math.random() * length)
          : TurbowarpCast.LIST_INVALID;
      }
    }
    const i = Math.floor(TurbowarpCast.toNumber(index));
    if (i < 1 || i > length) return TurbowarpCast.LIST_INVALID;
    return i;
  }

  static toRgbColorList(value: unknown): [number, number, number] {
    const color = TurbowarpCast.toRgbColorObject(value);
    return [color.r, color.g, color.b];
  }

  static toRgbColorObject(value: unknown): {
    r: number;
    g: number;
    b: number;
    a: number;
  } {
    if (typeof value === "string" && value.startsWith("#")) {
      const hex = value.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return {r, g, b, a: 255};
      }
      if (hex.length >= 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 255,
        };
      }
    }
    let n = TurbowarpCast.toNumber(value);
    if (n < 0) n = 0xffffffff + n + 1;
    const a = (n >> 24) & 0xff;
    return {
      r: (n >> 16) & 0xff,
      g: (n >> 8) & 0xff,
      b: n & 0xff,
      a: a === 0 ? 255 : a,
    };
  }
}

type TranslateFn = ((
  message: string | {default?: string; id?: string},
  args?: Record<string, unknown>,
) => string) & {
  setup: (translations?: Record<string, Record<string, string>> | null) => void;
  language: string;
};

function createTranslate(vm: TurbowarpVm | null): TranslateFn {
  let stored: Record<string, Record<string, string>> = {};

  const getLocale = () => {
    if (vm && typeof vm.getLocale === "function") {
      try {
        return vm.getLocale() || "ja";
      } catch {
        /* ignore */
      }
    }
    if (typeof navigator !== "undefined" && navigator.language) {
      return navigator.language;
    }
    return "ja";
  };

  const translate = ((
    message: string | {default?: string; id?: string},
  ): string => {
    const defaultMessage =
      typeof message === "string" ? message : (message.default ?? message.id ?? "");
    const locale = getLocale();
    const table = stored[locale] ?? stored[locale.split("-")[0] ?? ""] ?? {};
    const key = `_${defaultMessage}`;
    if (typeof table[key] === "string") return table[key];
    if (typeof message === "object" && message.id && typeof table[message.id] === "string") {
      return table[message.id];
    }
    return defaultMessage;
  }) as TranslateFn;

  translate.setup = translations => {
    if (translations) stored = translations;
  };

  Object.defineProperty(translate, "language", {
    configurable: true,
    enumerable: true,
    get: () => getLocale(),
  });

  translate.setup({});
  return translate;
}

export type TurbowarpScratch = {
  ArgumentType: typeof ArgumentType;
  BlockType: typeof BlockType;
  BlockShape: typeof BlockShape;
  TargetType: typeof TargetType;
  Cast: typeof TurbowarpCast;
  external: {importModule?: (url: string) => Promise<unknown>};
  extensions: {
    unsandboxed: boolean;
    register: (extensionObject: TurbowarpExtensionObject) => void;
  };
  vm: TurbowarpVm;
  renderer: unknown;
  translate: TranslateFn;
  fetch: (url: RequestInfo | URL, options?: RequestInit) => Promise<Response>;
  canFetch: (url: string) => Promise<boolean>;
  canOpenWindow: (url: string) => Promise<boolean>;
  canRedirect: (url: string) => Promise<boolean>;
  canRecordAudio: () => Promise<boolean>;
  canRecordVideo: () => Promise<boolean>;
  canReadClipboard: () => Promise<boolean>;
  canNotify: () => Promise<boolean>;
  canGeolocate: () => Promise<boolean>;
  canEmbed: (url: string) => Promise<boolean>;
  canDownload: (url: string, name: string) => Promise<boolean>;
  openWindow: (url: string, features?: string) => Promise<Window | null>;
  redirect: (url: string) => Promise<void>;
  download: (url: string, name: string) => Promise<void>;
};

let loadQueue: Promise<unknown> = Promise.resolve();

function parseURL(url: string): URL | null {
  try {
    return new URL(url, typeof location !== "undefined" ? location.href : undefined);
  } catch {
    return null;
  }
}

/** Build a TurboWarp-compatible Scratch global bound to the given VM. */
export function createTurbowarpScratch(
  vm: TurbowarpVm,
  register: (extensionObject: TurbowarpExtensionObject) => void,
): TurbowarpScratch {
  const Scratch: TurbowarpScratch = {
    ArgumentType,
    BlockType,
    BlockShape,
    TargetType,
    Cast: TurbowarpCast,
    external: {
      importModule: (url: string) => import(/* @vite-ignore */ url),
    },
    extensions: {
      unsandboxed: true,
      register,
    },
    vm,
    renderer:
      (vm.runtime &&
      typeof vm.runtime === "object" &&
      "renderer" in vm.runtime
        ? (vm.runtime as {renderer?: unknown}).renderer
        : undefined) ??
      vm.renderer ??
      null,
    translate: createTranslate(vm),
    canFetch: async () => true,
    canOpenWindow: async url => {
      const parsed = parseURL(url);
      return !!parsed && parsed.protocol !== "javascript:";
    },
    canRedirect: async url => {
      const parsed = parseURL(url);
      return !!parsed && parsed.protocol !== "javascript:";
    },
    canRecordAudio: async () => true,
    canRecordVideo: async () => true,
    canReadClipboard: async () => true,
    canNotify: async () => true,
    canGeolocate: async () => false,
    canEmbed: async () => true,
    canDownload: async (url, _name) => {
      const parsed = parseURL(url);
      return !!parsed && parsed.protocol !== "javascript:";
    },
    fetch: async (url, options) => fetch(url, options),
    openWindow: async (url, features) => {
      if (!(await Scratch.canOpenWindow(url))) {
        throw new Error(`Permission to open tab ${url} rejected.`);
      }
      const baseFeatures = "noreferrer";
      return window.open(
        url,
        "_blank",
        features ? `${baseFeatures},${features}` : baseFeatures,
      );
    },
    redirect: async url => {
      if (!(await Scratch.canRedirect(url))) {
        throw new Error(`Permission to redirect to ${url} rejected.`);
      }
      location.href = url;
    },
    download: async (url, name) => {
      if (!(await Scratch.canDownload(url, name))) {
        throw new Error(`Permission to download ${name} rejected.`);
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
  };
  return Scratch;
}

type TurbowarpScriptFetcher = (url: string) => Promise<string>;

const defaultTurbowarpScriptFetcher: TurbowarpScriptFetcher = async url => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `TurboWarp 拡張の取得に失敗しました (${response.status}): ${url}`,
    );
  }
  return response.text();
};

let turbowarpScriptFetcher: TurbowarpScriptFetcher =
  defaultTurbowarpScriptFetcher;

/** Test-only seam for classic-script source loading. */
export function setTurbowarpScriptFetcherForTests(
  fetcher: TurbowarpScriptFetcher | null,
): void {
  turbowarpScriptFetcher = fetcher ?? defaultTurbowarpScriptFetcher;
}

/**
 * Load a TurboWarp classic-script extension URL and return registered objects.
 * Serialized because loading mutates `globalThis.Scratch`.
 */
export function loadTurbowarpExtensionScript(
  vm: TurbowarpVm,
  extensionURL: string,
): Promise<TurbowarpExtensionObject[]> {
  const run = async () => {
    const extensionObjects: TurbowarpExtensionObject[] = [];
    let registered = false;

    // Animated Text / Pen+ expect TurboWarp VM+renderer export surfaces.
    ensureTurbowarpVmCompat(vm as CompatVm);

    const Scratch = createTurbowarpScratch(vm, extensionObject => {
      extensionObjects.push(extensionObject);
      registered = true;
    });

    const g = globalThis as typeof globalThis & {Scratch?: TurbowarpScratch};
    g.Scratch = Scratch;

    const previousAlert = globalThis.alert;
    // lab/text.js calls alert("VM is too old…") before throwing — surface that
    // as a normal Error instead of a blocking browser dialog.
    globalThis.alert = (message?: unknown) => {
      throw new Error(String(message ?? "alert"));
    };
    try {
      const source = await turbowarpScriptFetcher(extensionURL);
      // Classic scripts expect a global Scratch and top-level translate.setup.
      const evaluate = new Function(
        `${source}\n//# sourceURL=${extensionURL}`,
      ) as () => void;
      evaluate();
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`TurboWarp 拡張の読み込みに失敗しました: ${extensionURL}`);
    } finally {
      globalThis.alert = previousAlert;
      if (g.Scratch?.extensions) {
        g.Scratch.extensions.register = () => {
          throw new Error("Too late to register new extensions.");
        };
      }
    }

    if (!registered || extensionObjects.length === 0) {
      throw new Error(
        `TurboWarp 拡張が register されませんでした: ${extensionURL}`,
      );
    }
    return extensionObjects;
  };

  const queued = loadQueue.then(run, run);
  loadQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

/** Test-only: reset the serial load queue. */
export function resetTurbowarpLoadQueueForTests(): void {
  loadQueue = Promise.resolve();
}

export function isTurbowarpScriptUrl(url: string): boolean {
  try {
    const path = new URL(url, "https://example.invalid").pathname.toLowerCase();
    return path.endsWith(".js") && !path.endsWith(".mjs");
  } catch {
    const lower = url.toLowerCase().split("?")[0] ?? "";
    return lower.endsWith(".js") && !lower.endsWith(".mjs");
  }
}
