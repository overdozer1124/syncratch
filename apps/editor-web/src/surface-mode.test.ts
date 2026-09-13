import {describe, expect, it} from "vitest";
import {createStudentLinkToken} from "@blocksync/classroom-access";
import {detectEditorSurfaceMode} from "./surface-mode.js";

describe("detectEditorSurfaceMode", () => {
  it("detects admin and student surfaces", () => {
    expect(detectEditorSurfaceMode("/admin", "/")).toEqual({kind: "admin"});
    const token = createStudentLinkToken(() => new Uint8Array(16).fill(7));
    expect(detectEditorSurfaceMode(`/s/${token}`, "/")).toEqual({
      kind: "student",
      token,
    });
    expect(detectEditorSurfaceMode("/s", "/")).toEqual({kind: "student"});
    expect(detectEditorSurfaceMode("/", "/")).toEqual({kind: "community"});
  });
});
