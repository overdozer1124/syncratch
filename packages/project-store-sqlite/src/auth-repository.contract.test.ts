import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openSqliteStore } from "./index.js";
import type { createSqliteAuthRepository } from "./auth-repository.js";

type AuthRepo = ReturnType<typeof createSqliteAuthRepository>;

function openAuth() {
  const dir = mkdtempSync(join(tmpdir(), "r1-auth-db-"));
  const store = openSqliteStore({ dbPath: join(dir, "projects.sqlite") });
  return { store, auth: store.authRepo as AuthRepo };
}

describe("sqlite auth repository contracts", () => {
  it("survives reopen with auth tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-auth-reopen-"));
    const dbPath = join(dir, "projects.sqlite");
    const store1 = openSqliteStore({ dbPath });
    const orgId = store1.authRepo.withTransaction((tx) =>
      tx.ensureOrgForHostedDomain("example.com", "Example"),
    );
    store1.close();

    const store2 = openSqliteStore({ dbPath });
    const found = store2.authRepo.withTransaction((tx) =>
      tx.findOrgIdByHostedDomain("example.com"),
    );
    expect(found).toBe(orgId);
    store2.close();
  });

  it("enforces session composite FK to memberships", () => {
    const { store, auth } = openAuth();
    try {
      auth.withTransaction((tx) => {
        const orgId = tx.ensureOrgForHostedDomain("fk.example", "FK Org");
        tx.createUser({
          userId: "u1",
          primaryOrganizationId: orgId,
          email: "u1@fk.example",
          now: new Date().toISOString(),
        });
        expect(() =>
          tx.createSession({
            idHash: "sess-hash",
            userId: "u1",
            organizationId: orgId,
            csrfHash: "csrf-hash",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        ).toThrow();
      });
    } finally {
      store.close();
    }
  });

  it("unique (provider, subject) rejects concurrent first-login duplicates", () => {
    const { store, auth } = openAuth();
    try {
      auth.withTransaction((tx) => {
        const orgId = tx.ensureOrgForHostedDomain("uniq.example", "Uniq");
        const now = new Date().toISOString();
        tx.createUser({
          userId: "u-a",
          primaryOrganizationId: orgId,
          email: "a@uniq.example",
          now,
        });
        tx.ensureMembership(orgId, "u-a", "member");
        tx.insertExternalIdentity({
          provider: "google",
          subject: "sub-dup",
          userId: "u-a",
          organizationId: orgId,
          createdAt: now,
        });
      });

      expect(() =>
        auth.withTransaction((tx) => {
          const orgId = tx.findOrgIdByHostedDomain("uniq.example")!;
          const now = new Date().toISOString();
          tx.createUser({
            userId: "u-b",
            primaryOrganizationId: orgId,
            email: "b@uniq.example",
            now,
          });
          tx.ensureMembership(orgId, "u-b", "member");
          tx.insertExternalIdentity({
            provider: "google",
            subject: "sub-dup",
            userId: "u-b",
            organizationId: orgId,
            createdAt: now,
          });
        }),
      ).toThrow();
    } finally {
      store.close();
    }
  });

  it("creates session when membership exists; disabled user loses active membership", () => {
    const { store, auth } = openAuth();
    try {
      const result = auth.withTransaction((tx) => {
        const orgId = tx.ensureOrgForHostedDomain("ok.example", "OK");
        const now = new Date().toISOString();
        tx.createUser({
          userId: "u-ok",
          primaryOrganizationId: orgId,
          email: "ok@ok.example",
          now,
        });
        tx.ensureMembership(orgId, "u-ok", "member");
        tx.createSession({
          idHash: "hash-ok",
          userId: "u-ok",
          organizationId: orgId,
          csrfHash: "csrf-ok",
          createdAt: now,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        return { orgId, session: tx.getSessionByHash("hash-ok") };
      });
      expect(result.session?.userId).toBe("u-ok");
      expect(
        auth.withTransaction((tx) => tx.hasActiveMembership(result.orgId, "u-ok")),
      ).toBe(true);
      auth.disableUserForTest("u-ok");
      expect(
        auth.withTransaction((tx) => tx.hasActiveMembership(result.orgId, "u-ok")),
      ).toBe(false);
      auth.deleteMembershipForTest(result.orgId, "u-ok");
      expect(
        auth.withTransaction((tx) => tx.getSessionByHash("hash-ok")),
      ).toBeNull();
    } finally {
      store.close();
    }
  });
});
