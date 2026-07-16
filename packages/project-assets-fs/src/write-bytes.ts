import { writeSync as nodeWriteSync } from "node:fs";
import { PathSafetyError } from "./path-safety.js";

export type WriteChunkFn = (
  fd: number,
  buf: Uint8Array,
  offset: number,
  length: number,
) => number;

let writeChunkOverride: WriteChunkFn | null = null;

/** @internal Test-only hook for fault injection. */
export function __setWriteSyncForTests(fn: WriteChunkFn | null): void {
  writeChunkOverride = fn;
}

function writeChunk(
  fd: number,
  buf: Uint8Array,
  offset: number,
  length: number,
): number {
  const impl = writeChunkOverride ?? nodeWriteSync;
  return impl(fd, buf, offset, length);
}

/** Write every byte to fd; throws on zero-byte progress or incomplete write. */
export function writeAllBytesSync(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeChunk(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) {
      throw new PathSafetyError(`SHORT_WRITE:${offset}`);
    }
    offset += written;
  }
}
