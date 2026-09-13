import {describe, expect, it, vi} from "vitest";
import {requestRuntimeStageDraw} from "./execution-stage-draw.js";

describe("requestRuntimeStageDraw", () => {
  it("calls renderer.draw when available", () => {
    const draw = vi.fn();
    requestRuntimeStageDraw({renderer: {draw}});
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("ignores missing renderer and draw failures", () => {
    expect(() => requestRuntimeStageDraw(null)).not.toThrow();
    expect(() => requestRuntimeStageDraw({})).not.toThrow();
    expect(() =>
      requestRuntimeStageDraw({
        renderer: {
          draw: () => {
            throw new Error("gl lost");
          },
        },
      }),
    ).not.toThrow();
  });
});
