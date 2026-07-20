/**
 * Split large encrypted wire strings so RTCDataChannel.send() stays under
 * typical browser SCTP message limits (~16–256 KiB). Costume/sound assets in
 * Yjs updates routinely exceed a single send after base64 framing.
 *
 * Small wires are sent unchanged (legacy bare base64). Only oversized wires use
 * JSON chunk frames — wrapping every message in JSON previously correlated with
 * data-channel drops during ordinary block edits.
 */

/** Keep each chunk comfortably under common 16 KiB data-channel limits. */
export const DATA_CHANNEL_CHUNK_CHARS = 8_000;

/** Cap assemblies so a peer cannot force huge Array allocations pre-decrypt. */
export const DATA_CHANNEL_MAX_CHUNKS = 4_096;

export type DataChannelFrame =
  | {v: 1; t: "full"; d: string}
  | {v: 1; t: "chunk"; id: string; i: number; n: number; d: string};

export function packDataChannelWire(
  wire: string,
  chunkChars = DATA_CHANNEL_CHUNK_CHARS,
  randomId: () => string = () => crypto.randomUUID(),
): string[] {
  // Bare wire for the common case (block edits, awareness). Encrypted payloads
  // are base64 and never start with '{', so receivers can tell them apart from
  // chunk frames without a protocol version handshake.
  if (wire.length <= chunkChars) return [wire];

  const id = randomId();
  const n = Math.ceil(wire.length / chunkChars);
  if (n > DATA_CHANNEL_MAX_CHUNKS) {
    throw new Error(
      `data-channel wire requires ${n} chunks (max ${DATA_CHANNEL_MAX_CHUNKS})`,
    );
  }
  const frames: string[] = [];
  for (let i = 0; i < n; i += 1) {
    frames.push(
      JSON.stringify({
        v: 1,
        t: "chunk",
        id,
        i,
        n,
        d: wire.slice(i * chunkChars, (i + 1) * chunkChars),
      } satisfies DataChannelFrame),
    );
  }
  return frames;
}

export interface ChunkReassembler {
  push(raw: string): string | null;
  clear(): void;
}

export function createChunkReassembler(options?: {
  maxAssemblies?: number;
}): ChunkReassembler {
  const maxAssemblies = options?.maxAssemblies ?? 32;
  const assemblies = new Map<string, {parts: Array<string | undefined>; n: number; filled: number}>();

  return {
    push(raw) {
      // Fast path: bare encrypted wires (base64) never begin with '{'.
      if (raw.length === 0 || raw.charCodeAt(0) !== 0x7b) return raw;

      let frame: DataChannelFrame;
      try {
        frame = JSON.parse(raw) as DataChannelFrame;
      } catch {
        return raw;
      }
      if (!frame || frame.v !== 1) return null;
      // Accept legacy "full" frames from earlier framing builds.
      if (frame.t === "full" && typeof frame.d === "string") {
        if (frame.d.length > DATA_CHANNEL_CHUNK_CHARS) return null;
        return frame.d;
      }
      if (frame.t !== "chunk") return null;
      if (
        typeof frame.id !== "string" ||
        typeof frame.d !== "string" ||
        !Number.isInteger(frame.i) ||
        !Number.isInteger(frame.n) ||
        frame.n < 1 ||
        frame.n > DATA_CHANNEL_MAX_CHUNKS ||
        frame.d.length > DATA_CHANNEL_CHUNK_CHARS ||
        frame.i < 0 ||
        frame.i >= frame.n
      ) {
        return null;
      }
      let assembly = assemblies.get(frame.id);
      if (!assembly) {
        if (assemblies.size >= maxAssemblies) {
          const oldest = assemblies.keys().next().value;
          if (oldest !== undefined) assemblies.delete(oldest);
        }
        assembly = {
          parts: Array.from({length: frame.n}),
          n: frame.n,
          filled: 0,
        };
        assemblies.set(frame.id, assembly);
      }
      if (assembly.n !== frame.n) {
        assemblies.delete(frame.id);
        return null;
      }
      if (assembly.parts[frame.i] === undefined) {
        assembly.parts[frame.i] = frame.d;
        assembly.filled += 1;
      }
      if (assembly.filled < assembly.n) return null;
      assemblies.delete(frame.id);
      return assembly.parts.join("");
    },
    clear() {
      assemblies.clear();
    },
  };
}
