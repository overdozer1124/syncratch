/** Raster image header verification (Design §6.3). */

export class RasterVerifyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RasterVerifyError";
  }
}

export const RASTER_MAX_DIMENSION = 4096;
export const RASTER_MAX_PIXELS = 16_777_216;

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readI32LE(bytes: Uint8Array, offset: number): number {
  const unsigned = readU32LE(bytes, offset);
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RasterVerifyError("RASTER_DIMENSION");
  }
  if (width > RASTER_MAX_DIMENSION || height > RASTER_MAX_DIMENSION) {
    throw new RasterVerifyError("RASTER_DIMENSION");
  }
  if (width * height > RASTER_MAX_PIXELS) {
    throw new RasterVerifyError("RASTER_PIXELS");
  }
}

export function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33) {
    throw new RasterVerifyError("PNG_TRUNCATED");
  }
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) {
      throw new RasterVerifyError("PNG_SIGNATURE");
    }
  }
  const chunkLength = readU32BE(bytes, 8);
  if (chunkLength !== 13) {
    throw new RasterVerifyError("PNG_IHDR");
  }
  const chunkEnd = 8 + 4 + 4 + chunkLength + 4;
  if (bytes.length < chunkEnd) {
    throw new RasterVerifyError("PNG_TRUNCATED");
  }
  const chunkType = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunkType !== "IHDR") {
    throw new RasterVerifyError("PNG_IHDR");
  }
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  assertDimensions(width, height);
  return { width, height };
}

export function parseGifDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 13) {
    throw new RasterVerifyError("GIF_TRUNCATED");
  }
  const header = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!, bytes[5]!);
  if (header !== "GIF87a" && header !== "GIF89a") {
    throw new RasterVerifyError("GIF_SIGNATURE");
  }
  const width = readU16LE(bytes, 6);
  const height = readU16LE(bytes, 8);
  const packed = bytes[10]!;
  let offset = 13;
  if ((packed & 0x80) !== 0) {
    const gctSize = 2 << (packed & 0x07);
    const gctBytes = 3 * gctSize;
    if (bytes.length < offset + gctBytes) {
      throw new RasterVerifyError("GIF_TRUNCATED");
    }
    offset += gctBytes;
  }
  if (offset >= bytes.length) {
    throw new RasterVerifyError("GIF_TRUNCATED");
  }
  assertDimensions(width, height);
  return { width, height };
}

export function parseBmpDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 26) {
    throw new RasterVerifyError("BMP_TRUNCATED");
  }
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new RasterVerifyError("BMP_SIGNATURE");
  }
  const dibSize = readU32LE(bytes, 14);
  if (dibSize < 40 || 14 + dibSize > bytes.length) {
    throw new RasterVerifyError("BMP_HEADER");
  }
  const width = Math.abs(readI32LE(bytes, 18));
  const height = Math.abs(readI32LE(bytes, 22));
  assertDimensions(width, height);
  return { width, height };
}

export function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new RasterVerifyError("JPEG_SIGNATURE");
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (offset + 4 > bytes.length) {
      throw new RasterVerifyError("JPEG_TRUNCATED");
    }
    const segmentLength = readU16BE(bytes, offset + 2);
    if (segmentLength < 2) {
      throw new RasterVerifyError("JPEG_SEGMENT");
    }
    const isSof =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;
    if (isSof) {
      if (offset + 2 + segmentLength > bytes.length) {
        throw new RasterVerifyError("JPEG_TRUNCATED");
      }
      if (segmentLength < 8 || offset + 10 >= bytes.length) {
        throw new RasterVerifyError("JPEG_SEGMENT");
      }
      const componentCount = bytes[offset + 9]!;
      if (componentCount < 1 || componentCount > 4) {
        throw new RasterVerifyError("JPEG_SEGMENT");
      }
      const expectedLength = 8 + 3 * componentCount;
      if (segmentLength !== expectedLength) {
        throw new RasterVerifyError("JPEG_SEGMENT");
      }
      const height = readU16BE(bytes, offset + 5);
      const width = readU16BE(bytes, offset + 7);
      assertDimensions(width, height);
      return { width, height };
    }
    offset += 2 + segmentLength;
  }
  throw new RasterVerifyError("JPEG_SOF");
}

export function assertValidRasterBytes(bytes: Uint8Array, format: string): void {
  const fmt = format === "jpeg" ? "jpg" : format.toLowerCase();
  switch (fmt) {
    case "png":
      parsePngDimensions(bytes);
      return;
    case "jpg":
      parseJpegDimensions(bytes);
      return;
    case "gif":
      parseGifDimensions(bytes);
      return;
    case "bmp":
      parseBmpDimensions(bytes);
      return;
    default:
      throw new RasterVerifyError("RASTER_FORMAT");
  }
}
