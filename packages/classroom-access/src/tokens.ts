export type RandomBytes = (length: number) => Uint8Array;

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

/**
 * Opaque student-link token (≥128 bits of entropy).
 * Never log the raw token; never put it in query strings if avoidable.
 */
export function createStudentLinkToken(
  randomBytes: RandomBytes = defaultRandomBytes,
): string {
  const bytes = randomBytes(16);
  if (bytes.length < 16) {
    throw new Error("entropy source returned insufficient bytes");
  }
  const token = base64UrlFromBytes(bytes);
  if (token.length < 22) {
    throw new Error("token encoding too short");
  }
  return token;
}

/** Stable opaque ids for policies / links / admins (not secrets). */
export function createOpaqueId(
  randomBytes: RandomBytes = defaultRandomBytes,
): string {
  return base64UrlFromBytes(randomBytes(12));
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

export function isPlausibleStudentToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
