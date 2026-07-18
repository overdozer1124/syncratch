import {describe, expect, it, vi} from "vitest";
import {DEFAULT_LIMITS} from "@blocksync/sb3-tools/browser";
import {
  readSb3File,
  Sb3FileTooLargeError,
} from "./import-file.js";

describe("readSb3File", () => {
  it("rejects oversized files before reading arrayBuffer", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));

    await expect(
      readSb3File({
        size: DEFAULT_LIMITS.maxBytes + 1,
        arrayBuffer,
      }),
    ).rejects.toBeInstanceOf(Sb3FileTooLargeError);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("reads files at the configured limit", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await readSb3File({
      size: DEFAULT_LIMITS.maxBytes,
      arrayBuffer: async () => bytes.buffer,
    });

    expect(result).toEqual(bytes);
  });
});
