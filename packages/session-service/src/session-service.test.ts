import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  GoogleIdentityClaims,
  VerifyResult,
} from "@blocksync/google-identity";
import { AuthFailedError } from "./errors.js";
import { createMemoryAuthRepository } from "./memory-auth-repository.js";
import { createSessionService } from "./session-service.js";

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function claims(partial: Partial<GoogleIdentityClaims>): GoogleIdentityClaims {
  return {
    sub: "sub-1",
    email: "a@example.com",
    email_verified: true,
    hd: "example.com",
    aud: "client.apps.googleusercontent.com",
    iss: "https://accounts.google.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...partial,
  };
}

function ok(c: GoogleIdentityClaims): VerifyResult {
  return { ok: true, claims: c };
}

describe("createSessionService login", () => {
  it("first login creates immutable sub→org bind", async () => {
    const authRepo = createMemoryAuthRepository();
    const service = createSessionService({
      authRepo,
      verifyGoogleIdToken: async () => ok(claims({})),
      googleAudience: "client.apps.googleusercontent.com",
      allowedHostedDomains: ["example.com"],
      sessionTtlSec: 3600,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      randomToken: () => `tok-${Math.random()}`,
      hash,
    });
    const result = await service.loginWithGoogleIdToken("id-token");
    expect(result.organizationId).toBe("org-example.com");
    expect(result.email).toBe("a@example.com");
    expect(result.rawSessionId).toBeTruthy();
    expect(result.rawCsrfToken).toBeTruthy();
    const dump = authRepo.dump();
    expect(dump.identities).toHaveLength(1);
    expect(dump.identities[0]?.organizationId).toBe("org-example.com");
    expect(dump.users[0]?.displayName).toBeNull();
  });

  it("re-login same hd OK; different hd AUTH_FAILED without org change", async () => {
    const authRepo = createMemoryAuthRepository();
    const verify = vi.fn(async () =>
      ok(claims({ hd: "example.com", email: "a@example.com" })),
    );
    const service = createSessionService({
      authRepo,
      verifyGoogleIdToken: verify as never,
      googleAudience: "client.apps.googleusercontent.com",
      allowedHostedDomains: ["example.com", "other.com"],
      sessionTtlSec: 3600,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      randomToken: () => `tok-${Math.random()}`,
      hash,
    });
    await service.loginWithGoogleIdToken("t1");
    const before = authRepo.dump();

    verify.mockResolvedValueOnce(
      ok(claims({ hd: "other.com", email: "a@other.com" })),
    );
    await expect(service.loginWithGoogleIdToken("t2")).rejects.toBeInstanceOf(
      AuthFailedError,
    );
    const after = authRepo.dump();
    expect(after.identities).toEqual(before.identities);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.users[0]?.email).toBe("a@example.com");
  });

  it("parallel first login yields one identity", async () => {
    const authRepo = createMemoryAuthRepository();
    let tokenN = 0;
    const service = createSessionService({
      authRepo,
      verifyGoogleIdToken: async () => ok(claims({})),
      googleAudience: "client.apps.googleusercontent.com",
      allowedHostedDomains: ["example.com"],
      sessionTtlSec: 3600,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      randomToken: () => `tok-${tokenN++}`,
      hash,
    });

    const results = await Promise.all([
      service.loginWithGoogleIdToken("a"),
      service.loginWithGoogleIdToken("b"),
    ]);
    expect(results[0]?.userId).toBe(results[1]?.userId);
    expect(authRepo.dump().identities).toHaveLength(1);
    expect(authRepo.dump().users).toHaveLength(1);
  });

  it("retries when concurrent first-login unique constraint fires", async () => {
    const authRepo = createMemoryAuthRepository();
    const service = createSessionService({
      authRepo,
      verifyGoogleIdToken: async () => ok(claims({})),
      googleAudience: "client.apps.googleusercontent.com",
      allowedHostedDomains: ["example.com"],
      sessionTtlSec: 3600,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      randomToken: () => `tok-${Math.random()}`,
      hash,
    });
    authRepo.forceNextInsertCollision();
    const result = await service.loginWithGoogleIdToken("race");
    expect(result.userId).toBe("winner-user");
    expect(authRepo.dump().identities).toHaveLength(1);
  });

  it("updates email and never sets displayName from Google", async () => {
    const authRepo = createMemoryAuthRepository();
    const verify = vi.fn(async () =>
      ok(claims({ email: "one@example.com" })),
    );
    const service = createSessionService({
      authRepo,
      verifyGoogleIdToken: verify as never,
      googleAudience: "client.apps.googleusercontent.com",
      allowedHostedDomains: ["example.com"],
      sessionTtlSec: 3600,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      randomToken: () => `tok-${Math.random()}`,
      hash,
    });
    await service.loginWithGoogleIdToken("t1");
    verify.mockResolvedValueOnce(ok(claims({ email: "two@example.com" })));
    await service.loginWithGoogleIdToken("t2");
    expect(authRepo.dump().users[0]?.email).toBe("two@example.com");
    expect(authRepo.dump().users[0]?.displayName).toBeNull();
  });

  it("passes authorizedParties when configured", async () => {
    const verify = vi.fn(async () => ok(claims({})));
    const service = createSessionService({
      authRepo: createMemoryAuthRepository(),
      verifyGoogleIdToken: verify as never,
      googleAudience: "client.apps.googleusercontent.com",
      authorizedParties: ["web.client", "android.client"],
      allowedHostedDomains: ["example.com"],
      sessionTtlSec: 3600,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      randomToken: () => "tok",
      hash,
    });
    await service.loginWithGoogleIdToken("tok");
    expect(verify).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({
        authorizedParties: ["web.client", "android.client"],
        audience: "client.apps.googleusercontent.com",
        allowedHostedDomains: ["example.com"],
        requireEmailVerified: true,
      }),
    );
  });

  it("omits authorizedParties when empty", async () => {
    const verify = vi.fn(async () => ok(claims({})));
    const service = createSessionService({
      authRepo: createMemoryAuthRepository(),
      verifyGoogleIdToken: verify as never,
      googleAudience: "client.apps.googleusercontent.com",
      authorizedParties: [],
      allowedHostedDomains: ["example.com"],
      sessionTtlSec: 3600,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      randomToken: () => "tok",
      hash,
    });
    await service.loginWithGoogleIdToken("tok");
    const call = verify.mock.calls.at(0);
    expect(call).toBeDefined();
    const opts = call![1] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("authorizedParties");
  });
});
