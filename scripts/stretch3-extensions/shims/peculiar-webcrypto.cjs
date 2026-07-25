/**
 * NumberBank only needs Web Crypto. Prefer the browser SubtleCrypto surface.
 */
class Crypto {
  constructor() {
    if (typeof globalThis !== "undefined" && globalThis.crypto) {
      return globalThis.crypto;
    }
    throw new Error("Web Crypto API is not available in this environment");
  }
}

module.exports = {Crypto};
