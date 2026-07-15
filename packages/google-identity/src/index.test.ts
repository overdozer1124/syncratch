import { describe, expect, it } from "vitest";
import * as jose from "jose";
import { verifyGoogleIdToken } from "../src/index.js";

async function makeKeyPair() {
  return jose.generateKeyPair("RS256");
}

async function signToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "test-kid" },
) {
  return new jose.SignJWT(claims)
    .setProtectedHeader(header as jose.JWTHeaderParameters)
    .sign(privateKey);
}

describe("verifyGoogleIdToken", () => {
  const audience = "client-123.apps.googleusercontent.com";
  const now = () => 1_700_000_000;

  it("accepts a valid token with hd", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const token = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "user-1",
      email: "a@school.example",
      email_verified: true,
      hd: "school.example",
      azp: audience,
      iat: now(),
      exp: now() + 3600,
    });

    const result = await verifyGoogleIdToken(token, {
      audience,
      allowedHostedDomains: ["school.example"],
      authorizedParties: [audience],
      allowTestHooks: true,
      now,
      jwksProvider: async () => publicKey,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.sub).toBe("user-1");
  });

  it("rejects bad signature", async () => {
    const a = await makeKeyPair();
    const b = await makeKeyPair();
    const token = await signToken(a.privateKey, {
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "user-1",
      email_verified: true,
      iat: now(),
      exp: now() + 3600,
    });
    const result = await verifyGoogleIdToken(token, {
      audience,
      allowTestHooks: true,
      now,
      jwksProvider: async () => b.publicKey,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BAD_SIGNATURE");
  });

  it("rejects expired token", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const token = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "user-1",
      email_verified: true,
      iat: now() - 7200,
      exp: now() - 3600,
    });
    const result = await verifyGoogleIdToken(token, {
      audience,
      allowTestHooks: true,
      now,
      jwksProvider: async () => publicKey,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPIRED");
  });

  it("rejects wrong audience", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const t = Math.floor(Date.now() / 1000);
    const token = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: "other-client",
      sub: "user-1",
      email_verified: true,
      iat: t,
      exp: t + 3600,
    });
    const result = await verifyGoogleIdToken(token, {
      audience,
      allowTestHooks: true,
      jwksProvider: async () => publicKey,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BAD_AUD");
  });

  it("rejects unknown kid via provider error", async () => {
    const { privateKey } = await makeKeyPair();
    const token = await signToken(
      privateKey,
      {
        iss: "https://accounts.google.com",
        aud: audience,
        sub: "user-1",
        email_verified: true,
        iat: now(),
        exp: now() + 3600,
      },
      { alg: "RS256", kid: "rotated-away" },
    );
    const result = await verifyGoogleIdToken(token, {
      audience,
      allowTestHooks: true,
      now,
      jwksProvider: async () => {
        throw new Error('no applicable key found in the JSON Web Key Set for kid "rotated-away"');
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNKNOWN_KID");
  });

  it("rejects JWKS fetch failure", async () => {
    const { privateKey } = await makeKeyPair();
    const token = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "user-1",
      email_verified: true,
      iat: now(),
      exp: now() + 3600,
    });
    const result = await verifyGoogleIdToken(token, {
      audience,
      allowTestHooks: true,
      now,
      jwksProvider: async () => {
        throw new Error("JWKS fetch failed: network error");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("JWKS_FETCH_FAILED");
  });

  it("rejects missing hd in school mode", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const token = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "user-1",
      email_verified: true,
      iat: now(),
      exp: now() + 3600,
    });
    const result = await verifyGoogleIdToken(token, {
      audience,
      allowedHostedDomains: ["school.example"],
      allowTestHooks: true,
      now,
      jwksProvider: async () => publicKey,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HD_MISSING");
  });

  it("rejects hd mismatch (exact match only)", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const token = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "user-1",
      email_verified: true,
      hd: "other.example",
      iat: now(),
      exp: now() + 3600,
    });
    const result = await verifyGoogleIdToken(token, {
      audience,
      allowedHostedDomains: ["school.example"],
      allowTestHooks: true,
      now,
      jwksProvider: async () => publicKey,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HD_MISMATCH");
  });

  it("forbids custom JWKS outside test hooks", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const token = await signToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: audience,
      sub: "user-1",
      email_verified: true,
      iat: now(),
      exp: now() + 3600,
    });
    const prev = process.env.GATE0_TEST_HOOKS;
    delete process.env.GATE0_TEST_HOOKS;
    const prevNode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const result = await verifyGoogleIdToken(token, {
        audience,
        allowTestHooks: true,
        now,
        jwksProvider: async () => publicKey,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("HOOKS_FORBIDDEN");
    } finally {
      if (prev !== undefined) process.env.GATE0_TEST_HOOKS = prev;
      process.env.NODE_ENV = prevNode;
    }
  });
});
