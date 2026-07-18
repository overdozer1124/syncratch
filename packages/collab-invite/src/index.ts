/**
 * @experimental Small-room collaboration invitation model.
 *
 * An invitation carries a random room id, a random high-entropy secret, and the
 * Drive file id. This data lives in the URL fragment ONLY. It must never enter
 * request URLs, logs, Drive payloads, `.sb3`, IndexedDB project content, or
 * signaling messages. The signaling topic is derived from a one-way hash of the
 * room id and secret so that neither the secret nor the file id can be recovered
 * from anything a signaling server observes.
 */

const FRAGMENT_KEY = "blocksync-collab";

export interface CollabInvite {
  /** Random, low-sensitivity room identifier. */
  roomId: string;
  /** Random, high-entropy shared secret. Never sent to signaling. */
  secret: string;
  /** Drive file id all participants must be able to read. */
  driveFileId: string;
}

export type RandomBytes = (length: number) => Uint8Array;

export interface CreateInviteOptions {
  randomBytes?: RandomBytes;
}

function defaultRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bytesFromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function encodeText(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

function decodeText(value: string): string | null {
  const bytes = bytesFromBase64Url(value);
  if (!bytes) return null;
  try {
    return new TextDecoder(undefined, {fatal: true}).decode(bytes);
  } catch {
    return null;
  }
}

/** Create an invitation. Entropy is injectable so callers can test determinism. */
export function createInvite(
  driveFileId: string,
  options: CreateInviteOptions = {},
): CollabInvite {
  if (typeof driveFileId !== "string" || driveFileId.length === 0) {
    throw new Error("driveFileId must be a non-empty string");
  }
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  const roomId = base64UrlFromBytes(randomBytes(16));
  const secret = base64UrlFromBytes(randomBytes(32));
  if (roomId.length < 16 || secret.length < 32) {
    throw new Error("entropy source returned insufficient bytes");
  }
  return {roomId, secret, driveFileId};
}

function isInvite(value: unknown): value is CollabInvite {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "roomId" && key !== "secret" && key !== "driveFileId")) {
    return false;
  }
  return (
    typeof record.roomId === "string" &&
    record.roomId.length > 0 &&
    typeof record.secret === "string" &&
    record.secret.length > 0 &&
    typeof record.driveFileId === "string" &&
    record.driveFileId.length > 0
  );
}

/** Encode an invitation as the fragment portion (without a leading `#`). */
export function encodeInviteFragment(invite: CollabInvite): string {
  if (!isInvite(invite)) throw new Error("invalid invite");
  const payload = JSON.stringify({
    roomId: invite.roomId,
    secret: invite.secret,
    driveFileId: invite.driveFileId,
  });
  return `${FRAGMENT_KEY}=${encodeText(payload)}`;
}

/** Decode an invitation from a fragment string (leading `#` optional). */
export function decodeInviteFragment(fragment: string): CollabInvite | null {
  if (typeof fragment !== "string") return null;
  const body = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const prefix = `${FRAGMENT_KEY}=`;
  if (!body.startsWith(prefix)) return null;
  const encoded = body.slice(prefix.length);
  const json = decodeText(encoded);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isInvite(parsed)) return null;
  return {
    roomId: parsed.roomId,
    secret: parsed.secret,
    driveFileId: parsed.driveFileId,
  };
}

/** Build a shareable URL that carries the invitation in the fragment only. */
export function inviteUrl(baseUrl: string, invite: CollabInvite): string {
  const url = new URL(baseUrl);
  url.hash = encodeInviteFragment(invite);
  return url.toString();
}

/** Parse an invitation from a full URL's fragment. */
export function parseInviteFromUrl(url: string): CollabInvite | null {
  try {
    return decodeInviteFragment(new URL(url).hash);
  } catch {
    return null;
  }
}

/**
 * Derive the signaling topic from a one-way hash of the room id and secret.
 * The Drive file id is intentionally excluded so it can never be reconstructed
 * from the topic, and the hash prevents recovering the secret from signaling.
 */
export async function deriveSignalingTopic(
  invite: {roomId: string; secret: string; driveFileId?: string},
): Promise<string> {
  const material = new TextEncoder().encode(
    `blocksync-collab-topic\u0000v1\u0000${invite.roomId}\u0000${invite.secret}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", material);
  return base64UrlFromBytes(new Uint8Array(digest));
}
