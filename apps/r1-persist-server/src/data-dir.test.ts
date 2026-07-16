import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { __setWriteSyncForTests } from "@blocksync/project-assets-fs";
import { writeSync as nodeWriteSync } from "node:fs";
import {
  createR1DataLayout,
  streamToSpoolNoFollow,
} from "./data-dir.js";

describe("streamToSpoolNoFollow", () => {
  afterEach(() => {
    __setWriteSyncForTests(null);
  });

  it("writes every byte through partial-write chunks", async () => {
    __setWriteSyncForTests((fd, buf, offset, length) => {
      const sliceLen = Math.min(3, length);
      return nodeWriteSync(fd, buf, offset, sliceLen);
    });

    const dir = mkdtempSync(join(tmpdir(), "r1-spool-partial-"));
    const layout = createR1DataLayout(dir);
    const payload = new TextEncoder().encode("partial-write-test-bytes");
    const stream = Readable.from([payload]);

    const written = await streamToSpoolNoFollow(
      layout,
      "session-partial",
      stream,
      payload.byteLength + 1,
    );

    expect(written).toBe(payload.byteLength);
  });
});
