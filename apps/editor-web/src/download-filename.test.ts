import {describe, expect, it} from "vitest";
import {downloadFilename} from "./download-filename.js";

describe("downloadFilename", () => {
  it("removes control and Windows-forbidden characters", () => {
    expect(downloadFilename('bad\u0000<>:"/\\|?*name. ')).toBe("badname.sb3");
  });

  it("uses a safe fallback and limits the filename length", () => {
    expect(downloadFilename("...")).toBe("作品.sb3");
    expect(downloadFilename("CON")).toBe("作品.sb3");
    expect(downloadFilename("lpt9")).toBe("作品.sb3");
    expect(downloadFilename("a".repeat(500)).length).toBeLessThanOrEqual(104);
  });
});
