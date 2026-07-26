/**
 * Bridge stock Scratch VM / scratch-render to TurboWarp extension expectations.
 *
 * Extensions like Animated Text (lab/text) require:
 * - `vm.renderer` (TW exposes a getter; stock only has `runtime.renderer`)
 * - `vm.exports.RenderedTarget`
 * - `renderer.exports.{Skin, CanvasMeasurementProvider, twgl}`
 * - `renderer.createTextWrapper`
 * - `runtime.stageWidth` / `stageHeight`
 * - `runtime` `BEFORE_EXECUTE` events
 * - Skin `emitWasAltered()` (TW Skin API)
 */

export type CompatVm = {
  renderer?: unknown;
  runtime?: CompatRuntime | null;
  exports?: Record<string, unknown>;
};

export type CompatRuntime = {
  renderer?: CompatRenderer | null;
  targets?: Array<{constructor: unknown; isStage?: boolean} | null | undefined>;
  stageWidth?: number;
  stageHeight?: number;
  emit?: (event: string, ...args: unknown[]) => void;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  _step?: (...args: unknown[]) => unknown;
  _syncratchBeforeExecutePatched?: boolean;
};

export type CompatRenderer = {
  gl?: WebGLRenderingContext | WebGL2RenderingContext;
  exports?: Record<string, unknown>;
  _allSkins?: Array<{constructor: Function} | null | undefined>;
  createTextWrapper?: (measurementProvider: MeasurementProvider) => TextWrapperLike;
};

export type MeasurementProvider = {
  beginMeasurementSession?: () => unknown;
  endMeasurementSession?: (session: unknown) => void;
  measureText: (text: string) => number;
};

export type TextWrapperLike = {
  wrapText: (maxWidth: number, text: string) => string[];
};

/** Minimal CanvasMeasurementProvider matching scratch-render. */
export class CanvasMeasurementProvider {
  private _ctx: CanvasRenderingContext2D;
  private _cache: Record<string, number> = {};

  constructor(ctx: CanvasRenderingContext2D) {
    this._ctx = ctx;
  }

  beginMeasurementSession(): void {}
  endMeasurementSession(): void {}

  measureText(text: string): number {
    if (this._cache[text] === undefined) {
      this._cache[text] = this._ctx.measureText(text).width;
    }
    return this._cache[text];
  }
}

/** Simple word-wrapping TextWrapper (good enough for Animated Text). */
export function createSimpleTextWrapper(
  measurementProvider: MeasurementProvider,
): TextWrapperLike {
  return {
    wrapText(maxWidth: number, text: string): string[] {
      const normalized = text.normalize();
      measurementProvider.beginMeasurementSession?.();
      const paragraphs = normalized.split(/\r?\n/);
      const lines: string[] = [];
      for (const paragraph of paragraphs) {
        if (paragraph.length === 0) {
          lines.push("");
          continue;
        }
        const words = paragraph.split(/(\s+)/);
        let current = "";
        for (const word of words) {
          const proposed = current + word;
          if (
            current &&
            measurementProvider.measureText(proposed) > maxWidth &&
            word.trim().length > 0
          ) {
            lines.push(current.replace(/\s+$/, ""));
            current = word.replace(/^\s+/, "");
          } else {
            current = proposed;
          }
        }
        lines.push(current.replace(/\s+$/, ""));
      }
      if (lines.length === 0) lines.push("");
      measurementProvider.endMeasurementSession?.(undefined);
      return lines;
    },
  };
}

/** Minimal twgl.createTexture used by AnimatedText / Pen skins. */
export function createMinimalTwgl() {
  return {
    createTexture(
      gl: WebGLRenderingContext | WebGL2RenderingContext,
      options: {
        auto?: boolean;
        wrap?: number;
        src?: TexImageSource;
        minMag?: number;
      } = {},
    ): WebGLTexture {
      const texture = gl.createTexture();
      if (!texture) {
        throw new Error("WebGLTexture を作成できませんでした");
      }
      const wrap = options.wrap ?? gl.CLAMP_TO_EDGE;
      const filter = options.minMag ?? gl.LINEAR;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      if (options.src) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          options.src,
        );
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 0]),
        );
      }
      return texture;
    },
    v3: {
      create(x = 0, y = 0, z = 0): Float32Array {
        return new Float32Array([x, y, z]);
      },
    },
  };
}

function resolveSkinBase(
  renderer: CompatRenderer,
): (new (id: number, renderer?: unknown) => unknown) & {
  Events?: {WasAltered: string};
  prototype: object;
} {
  const skins = renderer._allSkins ?? [];
  for (const skin of skins) {
    if (!skin || typeof skin !== "object") continue;
    const bitmapProto = Object.getPrototypeOf(skin);
    if (!bitmapProto) continue;
    const skinProto = Object.getPrototypeOf(bitmapProto);
    const Skin = skinProto?.constructor as
      | ((new (id: number) => unknown) & {
          Events?: {WasAltered: string};
          prototype: object;
        })
      | undefined;
    if (Skin && Skin.Events?.WasAltered === "WasAltered") {
      return Skin as (new (id: number, renderer?: unknown) => unknown) & {
        Events?: {WasAltered: string};
        prototype: object;
      };
    }
  }
  throw new Error(
    "TurboWarp 互換: レンダラから Skin クラスを取得できませんでした",
  );
}

function createCompatSkinClass(
  BaseSkin: (new (id: number, renderer?: unknown) => unknown) & {
    Events?: {WasAltered: string};
    prototype: object;
  },
) {
  class CompatSkin extends (BaseSkin as new (
    id: number,
  ) => {
    emit: (event: string) => void;
    _renderer?: unknown;
  }) {
    constructor(id: number, renderer?: unknown) {
      super(id);
      this._renderer = renderer;
    }

    emitWasAltered(): void {
      const event = BaseSkin.Events?.WasAltered ?? "WasAltered";
      this.emit(event);
    }
  }
  (CompatSkin as unknown as {Events?: {WasAltered: string}}).Events =
    BaseSkin.Events ?? {WasAltered: "WasAltered"};
  return CompatSkin;
}

function resolveRenderedTarget(runtime: CompatRuntime): unknown {
  const targets = runtime.targets ?? [];
  const preferred =
    targets.find(target => target && target.isStage === false) ??
    targets.find(Boolean);
  if (!preferred?.constructor) {
    throw new Error(
      "TurboWarp 互換: RenderedTarget クラスを取得できませんでした",
    );
  }
  return preferred.constructor;
}

/**
 * Ensure the live VM/renderer expose TurboWarp extension internals.
 * Safe to call multiple times. Soft-noops when renderer/targets are missing
 * (unit tests / early boot); full gallery loads always have both.
 */
export function ensureTurbowarpVmCompat(vm: CompatVm): void {
  const runtime = vm.runtime;
  if (!runtime || typeof runtime !== "object") {
    return;
  }

  if (typeof runtime.stageWidth !== "number") {
    runtime.stageWidth = 480;
  }
  if (typeof runtime.stageHeight !== "number") {
    runtime.stageHeight = 360;
  }

  if (!runtime._syncratchBeforeExecutePatched && typeof runtime._step === "function") {
    const originalStep = runtime._step.bind(runtime);
    runtime._step = (...args: unknown[]) => {
      runtime.emit?.("BEFORE_EXECUTE");
      return originalStep(...args);
    };
    runtime._syncratchBeforeExecutePatched = true;
  }

  const renderer = (vm.renderer ?? runtime.renderer) as CompatRenderer | null;
  if (!renderer || typeof renderer !== "object") {
    return;
  }

  // Stock VM has no `vm.renderer` getter (TurboWarp does).
  if (vm.renderer !== renderer) {
    try {
      Object.defineProperty(vm, "renderer", {
        configurable: true,
        enumerable: true,
        get: () => runtime.renderer,
        set: value => {
          runtime.renderer = value as CompatRenderer;
        },
      });
    } catch {
      vm.renderer = renderer;
    }
  }

  if (typeof renderer.createTextWrapper !== "function") {
    renderer.createTextWrapper = measurementProvider =>
      createSimpleTextWrapper(measurementProvider);
  }

  try {
    const BaseSkin = resolveSkinBase(renderer);
    const CompatSkin = createCompatSkinClass(BaseSkin);
    const twgl = createMinimalTwgl();
    renderer.exports = {
      ...(renderer.exports ?? {}),
      Skin: CompatSkin,
      CanvasMeasurementProvider,
      twgl,
    };
  } catch {
    // Skins not ready yet — extensions that need them will fail loudly later.
  }

  try {
    vm.exports = {
      ...(vm.exports ?? {}),
      RenderedTarget: resolveRenderedTarget(runtime),
    };
  } catch {
    // No targets yet.
  }
}
