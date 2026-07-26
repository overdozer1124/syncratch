import {describe, expect, it, vi} from "vitest";
import {
  CanvasMeasurementProvider,
  createMinimalTwgl,
  createSimpleTextWrapper,
  ensureTurbowarpVmCompat,
} from "./turbowarp-vm-compat.js";

function makeFakeVm() {
  class BaseSkin {
    static Events = {WasAltered: "WasAltered"};
    _id: number;
    _renderer?: unknown;
    emit = vi.fn();
    constructor(id: number) {
      this._id = id;
    }
  }
  class BitmapSkin extends BaseSkin {
    constructor(id: number, renderer: unknown) {
      super(id);
      this._renderer = renderer;
    }
  }
  class RenderedTarget {
    isStage = false;
  }

  const renderer = {
    gl: {} as WebGLRenderingContext,
    _allSkins: [new BitmapSkin(1, null)] as Array<{constructor: Function}>,
  };

  const runtime = {
    renderer,
    targets: [new RenderedTarget()],
    emit: vi.fn(),
    _step: vi.fn(),
  };

  const vm = {
    runtime,
  };

  return {vm, runtime, renderer, BaseSkin, RenderedTarget};
}

describe("turbowarp vm compat", () => {
  it("wraps text with the simple TextWrapper", () => {
    const ctx = {
      measureText: (text: string) => ({width: text.length * 10}),
    } as unknown as CanvasRenderingContext2D;
    const provider = new CanvasMeasurementProvider(ctx);
    const wrapper = createSimpleTextWrapper(provider);
    expect(wrapper.wrapText(50, "hello world friends")).toEqual([
      "hello",
      "world",
      "friends",
    ]);
  });

  it("creates WebGL textures through the minimal twgl shim", () => {
    const calls: string[] = [];
    const gl = {
      TEXTURE_2D: 1,
      CLAMP_TO_EDGE: 2,
      LINEAR: 3,
      RGBA: 4,
      UNSIGNED_BYTE: 5,
      UNPACK_PREMULTIPLY_ALPHA_WEBGL: 6,
      createTexture: () => ({id: "tex"}),
      bindTexture: () => calls.push("bind"),
      texParameteri: () => calls.push("param"),
      texImage2D: () => calls.push("image"),
      pixelStorei: () => calls.push("pixel"),
    } as unknown as WebGLRenderingContext;
    const twgl = createMinimalTwgl();
    const texture = twgl.createTexture(gl, {auto: false, wrap: gl.CLAMP_TO_EDGE});
    expect(texture).toEqual({id: "tex"});
    expect(calls).toContain("bind");
    expect(calls).toContain("image");
  });

  it("injects TurboWarp export surfaces required by Animated Text", () => {
    const {vm, runtime, renderer, BaseSkin, RenderedTarget} = makeFakeVm();
    ensureTurbowarpVmCompat(vm);

    expect(vm.renderer).toBe(renderer);
    expect(runtime.stageWidth).toBe(480);
    expect(runtime.stageHeight).toBe(360);
    expect(vm.exports?.RenderedTarget).toBe(RenderedTarget);
    expect(renderer.exports?.CanvasMeasurementProvider).toBe(
      CanvasMeasurementProvider,
    );
    expect(typeof renderer.createTextWrapper).toBe("function");

    const Skin = renderer.exports?.Skin as new (
      id: number,
      renderer?: unknown,
    ) => {emitWasAltered: () => void; _renderer?: unknown; emit: ReturnType<typeof vi.fn>};
    const skin = new Skin(9, renderer);
    expect(skin._renderer).toBe(renderer);
    expect(Object.getPrototypeOf(Object.getPrototypeOf(skin))).toBe(
      BaseSkin.prototype,
    );
    skin.emitWasAltered();
    expect(skin.emit).toHaveBeenCalledWith("WasAltered");

    runtime._step?.();
    expect(runtime.emit).toHaveBeenCalledWith("BEFORE_EXECUTE");
  });

  it("lets AnimatedText's version gate pass", () => {
    const {vm, renderer} = makeFakeVm();
    ensureTurbowarpVmCompat(vm);
    const tooOld =
      !renderer.exports || !renderer.exports.Skin || !vm.exports;
    expect(tooOld).toBe(false);
  });

  it("satisfies the AnimatedText bootstrap checks used at load time", () => {
    const {vm, renderer} = makeFakeVm();
    ensureTurbowarpVmCompat(vm);
    // Mirror lab/text.js preamble (without WebGL work).
    const ScratchVm = vm as {renderer?: {exports?: unknown; gl?: unknown}; exports?: unknown};
    const resolvedRenderer = ScratchVm.renderer;
    expect(resolvedRenderer).toBe(renderer);
    expect(resolvedRenderer?.exports && (resolvedRenderer.exports as {Skin?: unknown}).Skin).toBeTruthy();
    expect(ScratchVm.exports).toBeTruthy();
    const Skin = (resolvedRenderer!.exports as {Skin: new (id: number, r?: unknown) => {emitWasAltered: () => void}}).Skin;
    const skin = new Skin(1, resolvedRenderer);
    expect(typeof skin.emitWasAltered).toBe("function");
    expect(typeof renderer.createTextWrapper).toBe("function");
  });
});
