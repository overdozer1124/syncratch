/**
 * AES-256-GCM encryption for admin Google refresh tokens.
 * Keys are loaded from SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON with rotation via
 * SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID.
 */
import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface AdminGoogleCryptoKeys {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface EncryptedSecret {
  keyId: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

export class AdminGoogleCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminGoogleCryptoError";
  }
}

function decodeKeyMaterial(keyId: string, encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new AdminGoogleCryptoError(
      `Admin Google key "${keyId}" must decode to ${KEY_BYTES} bytes`,
    );
  }
  return key;
}

export function parseAdminGoogleCryptoKeysFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AdminGoogleCryptoKeys | null {
  const activeKeyId = env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID?.trim() ?? "";
  const keysJson = env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON?.trim() ?? "";
  if (!activeKeyId || !keysJson) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(keysJson) as unknown;
  } catch {
    throw new AdminGoogleCryptoError(
      "SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON must be valid JSON",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AdminGoogleCryptoError(
      "SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON must be an object",
    );
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(parsed)) {
    if (typeof encoded !== "string" || !encoded.trim()) {
      throw new AdminGoogleCryptoError(
        `Admin Google key "${keyId}" must be a base64 string`,
      );
    }
    keys.set(keyId, decodeKeyMaterial(keyId, encoded.trim()));
  }
  if (keys.size === 0) {
    throw new AdminGoogleCryptoError(
      "SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON must contain at least one key",
    );
  }
  if (!keys.has(activeKeyId)) {
    throw new AdminGoogleCryptoError(
      `SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID "${activeKeyId}" is not in keys JSON`,
    );
  }
  return {activeKeyId, keys};
}

export function encryptAdminGoogleSecret(
  keys: AdminGoogleCryptoKeys,
  plaintext: string,
): EncryptedSecret {
  const key = keys.keys.get(keys.activeKeyId);
  if (!key) {
    throw new AdminGoogleCryptoError(
      `Active admin Google key "${keys.activeKeyId}" is missing`,
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    keyId: keys.activeKeyId,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptAdminGoogleSecret(
  keys: AdminGoogleCryptoKeys,
  secret: EncryptedSecret,
): string {
  const key = keys.keys.get(secret.keyId);
  if (!key) {
    throw new AdminGoogleCryptoError(
      `Admin Google key "${secret.keyId}" is not available for decryption`,
    );
  }
  const iv = Buffer.from(secret.iv, "base64");
  const ciphertext = Buffer.from(secret.ciphertext, "base64");
  const tag = Buffer.from(secret.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new AdminGoogleCryptoError("Invalid admin Google ciphertext metadata");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Deterministic 32-byte test key material for unit tests only. */
export function testAdminGoogleCryptoKeys(
  keyId = "test-key",
): AdminGoogleCryptoKeys {
  const key = Buffer.alloc(KEY_BYTES, 7);
  return {activeKeyId: keyId, keys: new Map([[keyId, key]])};
}
