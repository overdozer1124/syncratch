import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryAuthRepository } from "./memory-auth-repository.js";
import {
  SessionAuthContext,
  UnauthenticatedError,
} from "./session-auth-context.js";

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function seedSession(authRepo: ReturnType<typeof createMemoryAuthRepository>) {
  return authRepo.withTransaction((tx) => {
    const orgId = tx.ensureOrgForHostedDomain("example.com", "example.com");
    tx.createUser({
      userId: "u1",
      primaryOrganizationId: orgId,
      email: "a@example.com",
      now: "2026-07-15T00:00:00.000Z",
    });
    tx.ensureMembership(orgId, "u1", "member");
    tx.createSession({
      idHash: hash("raw-session"),
      userId: "u1",
      organizationId: orgId,
      csrfHash: hash("csrf"),
      createdAt: "2026-07-15T00:00:00.000Z",
      expiresAt: "2026-07-16T00:00:00.000Z",
    });
    return orgId;
  });
}

describe("SessionAuthContext", () => {
  it("resolves principal from session cookie and ignores spoof headers", async () => {
    const authRepo = createMemoryAuthRepository();
    seedSession(authRepo);
    const auth = new SessionAuthContext({
      authRepo,
      hash,
      now: () => new Date("2026-07-15T12:00:00.000Z"),
    });
    const principal = await auth.resolve({
      headers: { "x-user-id": "user-a", "x-organization-id": "spoof-org" },
      cookies: { blocksync_session: "raw-session" },
    });
    expect(principal).toEqual({
      userId: "u1",
      organizationId: "org-example.com",
    });
  });

  it("throws when cookie missing even if spoof headers present", async () => {
    const authRepo = createMemoryAuthRepository();
    seedSession(authRepo);
    const auth = new SessionAuthContext({
      authRepo,
      hash,
      now: () => new Date("2026-07-15T12:00:00.000Z"),
    });
    await expect(
      auth.resolve({
        headers: { "x-user-id": "user-a" },
        cookies: {},
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("throws when membership inactive (disabled user)", async () => {
    const authRepo = createMemoryAuthRepository();
    seedSession(authRepo);
    authRepo.disableUserForTest("u1");
    const auth = new SessionAuthContext({
      authRepo,
      hash,
      now: () => new Date("2026-07-15T12:00:00.000Z"),
    });
    await expect(
      auth.resolve({
        headers: {},
        cookies: { blocksync_session: "raw-session" },
      }),
    ).rejects.toThrow(/membership/i);
  });
});
