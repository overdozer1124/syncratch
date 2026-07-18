import {DEFAULT_LIMITS} from "@blocksync/sb3-tools/browser";

export class Sb3FileTooLargeError extends Error {
  constructor(size: number) {
    super(`SB3 file is too large (${size} bytes)`);
    this.name = "Sb3FileTooLargeError";
  }
}

export interface Sb3FileLike {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export async function readSb3File(file: Sb3FileLike): Promise<Uint8Array> {
  if (file.size > DEFAULT_LIMITS.maxBytes) {
    throw new Sb3FileTooLargeError(file.size);
  }
  return new Uint8Array(await file.arrayBuffer());
}
