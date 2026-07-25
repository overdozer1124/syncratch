/**
 * Open Relay Project TURN via time-limited HMAC credentials (static-auth).
 *
 * The old long-term username/password `openrelayproject`/`openrelayproject` is
 * no longer accepted. Metered documents `staticauth.openrelay.metered.ca` with
 * shared secret `openrelayprojectsecret` (TURN REST / use-auth-secret style).
 */

export const OPENRELAY_STATIC_AUTH_HOST = "staticauth.openrelay.metered.ca";
/** Public Open Relay static-auth secret (documented by Metered for Nextcloud/etc.). */
export const OPENRELAY_STATIC_AUTH_SECRET = "openrelayprojectsecret";
export const OPENRELAY_CREDENTIAL_TTL_SEC = 12 * 60 * 60;

const STUN_SERVERS: RTCIceServer[] = [
  {urls: "stun:stun.l.google.com:19302"},
  {urls: "stun:stun1.l.google.com:19302"},
];

export interface OpenRelayIceOptions {
  nowMs?: number;
  ttlSec?: number;
  userId?: string;
  /** Override HMAC for tests. */
  hmacSha1Base64?: (message: string, secret: string) => Promise<string>;
}

async function defaultHmacSha1Base64(
  message: string,
  secret: string,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SubtleCrypto is required to mint TURN credentials");
  }
  const enc = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    enc.encode(secret),
    {name: "HMAC", hash: "SHA-1"},
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** STUN only — used when TURN minting is skipped (tests / explicit empty ICE). */
export function createStunOnlyIceServers(): RTCIceServer[] {
  return STUN_SERVERS.map(server => ({...server}));
}

/**
 * Google STUN + Open Relay TURN with ephemeral HMAC credentials.
 * Safe to call in the browser; credentials expire after `ttlSec`.
 */
export async function createOpenRelayIceServers(
  options: OpenRelayIceOptions = {},
): Promise<RTCIceServer[]> {
  const nowMs = options.nowMs ?? Date.now();
  const ttlSec = options.ttlSec ?? OPENRELAY_CREDENTIAL_TTL_SEC;
  const userId = (options.userId ?? "syncratch").replace(/:/g, "-");
  const expiry = Math.floor(nowMs / 1000) + ttlSec;
  const username = `${expiry}:${userId}`;
  const hmac = options.hmacSha1Base64 ?? defaultHmacSha1Base64;
  const credential = await hmac(username, OPENRELAY_STATIC_AUTH_SECRET);
  const host = OPENRELAY_STATIC_AUTH_HOST;

  return [
    ...createStunOnlyIceServers(),
    {
      urls: [
        `turn:${host}:80`,
        `turn:${host}:443`,
        `turn:${host}:443?transport=tcp`,
        `turns:${host}:443`,
      ],
      username,
      credential,
    },
  ];
}
