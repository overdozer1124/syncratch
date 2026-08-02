import {describe, expect, it} from "vitest";
import {
  decryptAdminGoogleSecret,
  encryptAdminGoogleSecret,
  parseAdminGoogleCryptoKeysFromEnv,
  testAdminGoogleCryptoKeys,
} from "./admin-token-crypto.js";

describe("admin-token-crypto", () => {
  it("round-trips secrets with the active key", () => {
    const keys = testAdminGoogleCryptoKeys();
    const encrypted = encryptAdminGoogleSecret(keys, "refresh-token-value");
    expect(encrypted.keyId).toBe("test-key");
    expect(decryptAdminGoogleSecret(keys, encrypted)).toBe("refresh-token-value");
  });

  it("parses keys JSON from env", () => {
    const material = Buffer.alloc(32, 9).toString("base64");
    const keys = parseAdminGoogleCryptoKeysFromEnv({
      SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID: "k1",
      SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON: JSON.stringify({k1: material}),
    });
    expect(keys?.activeKeyId).toBe("k1");
    expect(keys?.keys.get("k1")?.length).toBe(32);
  });
});
