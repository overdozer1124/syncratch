import {DEFAULT_LIMITS} from "@blocksync/sb3-tools/browser";

const MIB = 1024 * 1024;

export class Sb3FileTooLargeError extends Error {
  constructor(size: number) {
    super(
      `作品ファイルが大きすぎます（${(size / MIB).toFixed(1)}MB）。` +
        `${Math.round(DEFAULT_LIMITS.maxBytes / MIB)}MB までなら開けます。`,
    );
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
