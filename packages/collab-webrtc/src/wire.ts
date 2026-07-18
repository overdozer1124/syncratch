/**
 * Room cipher and encrypted channel framing.
 *
 * All WebRTC data-channel payloads are encrypted with an AES-GCM key derived
 * from the room secret. The secret itself is never transmitted; only peers who
 * already hold the invitation secret can read updates or awareness. There is no
 * plaintext fallback and no public key exchange over signaling.
 */

const NONCE_BYTES = 12;

export interface RoomCipher {
  seal(plaintext: Uint8Array): Promise<Uint8Array>;
  open(sealed: Uint8Array): Promise<Uint8Array>;
}

/** Derive an AES-GCM key from the room secret. */
export async function createRoomCipher(secret: string): Promise<RoomCipher> {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("room secret is required for encryption");
  }
  const material = new TextEncoder().encode(`blocksync-collab-key\u0000v1\u0000${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  const key = await crypto.subtle.importKey("raw", digest, {name: "AES-GCM"}, false, [
    "encrypt",
    "decrypt",
  ]);
  return {
    async seal(plaintext) {
      const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          {name: "AES-GCM", iv: nonce as BufferSource},
          key,
          plaintext as BufferSource,
        ),
      );
      const out = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
      out.set(nonce, 0);
      out.set(ciphertext, NONCE_BYTES);
      return out;
    },
    async open(sealed) {
      if (sealed.byteLength <= NONCE_BYTES) {
        throw new Error("sealed payload too short");
      }
      const nonce = sealed.subarray(0, NONCE_BYTES);
      const ciphertext = sealed.subarray(NONCE_BYTES);
      const plaintext = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv: nonce as BufferSource},
        key,
        ciphertext as BufferSource,
      );
      return new Uint8Array(plaintext);
    },
  };
}

export const FRAME_SYNC_STEP1 = 0;
export const FRAME_SYNC_STEP2 = 1;
export const FRAME_UPDATE = 2;
export const FRAME_AWARENESS = 3;

export type FrameKind =
  | typeof FRAME_SYNC_STEP1
  | typeof FRAME_SYNC_STEP2
  | typeof FRAME_UPDATE
  | typeof FRAME_AWARENESS;

export interface ChannelMessage {
  kind: FrameKind;
  /** Uint8Array for sync/update frames; a plain awareness state object otherwise. */
  payload: Uint8Array | Record<string, unknown> | null;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Serialize + encrypt a channel message to a base64 string safe for text data channels. */
export async function encodeChannelMessage(
  cipher: RoomCipher,
  message: ChannelMessage,
): Promise<string> {
  const envelope =
    message.kind === FRAME_AWARENESS
      ? {k: message.kind, a: message.payload}
      : {k: message.kind, b: base64FromBytes(message.payload as Uint8Array)};
  const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
  const sealed = await cipher.seal(plaintext);
  return base64FromBytes(sealed);
}

/** Decrypt + parse a channel message. Throws if the secret does not match. */
export async function decodeChannelMessage(
  cipher: RoomCipher,
  wire: string,
): Promise<ChannelMessage> {
  const sealed = bytesFromBase64(wire);
  const plaintext = await cipher.open(sealed);
  const envelope = JSON.parse(new TextDecoder().decode(plaintext)) as {
    k: FrameKind;
    b?: string;
    a?: Record<string, unknown> | null;
  };
  if (envelope.k === FRAME_AWARENESS) {
    return {kind: FRAME_AWARENESS, payload: envelope.a ?? null};
  }
  return {kind: envelope.k, payload: bytesFromBase64(envelope.b ?? "")};
}
