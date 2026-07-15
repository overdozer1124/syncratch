import { describe, expect, it } from "vitest";
import * as authContext from "./index.js";
import { StubAuthContext } from "./index.js";

describe("StubAuthContext", () => {
  it("resolves user-a to org-demo", async () => {
    const auth = new StubAuthContext();
    const principal = await auth.resolve({
      headers: { "x-user-id": "user-a" },
    });
    expect(principal).toEqual({
      userId: "user-a",
      organizationId: "org-demo",
      displayName: "User A",
    });
  });

  it("resolves user-b to org-demo", async () => {
    const auth = new StubAuthContext();
    const principal = await auth.resolve({
      headers: { "x-user-id": "user-b" },
    });
    expect(principal.userId).toBe("user-b");
    expect(principal.organizationId).toBe("org-demo");
  });

  it("throws for unknown user", async () => {
    const auth = new StubAuthContext();
    await expect(
      auth.resolve({ headers: { "x-user-id": "user-unknown" } }),
    ).rejects.toThrow(/unknown|unauthenticated/i);
  });

  it("throws when x-user-id is missing", async () => {
    const auth = new StubAuthContext();
    await expect(auth.resolve({ headers: {} })).rejects.toThrow();
  });

  it("does not export ACL helpers", () => {
    expect(authContext).not.toHaveProperty("canAccessProject");
    expect(StubAuthContext.prototype).not.toHaveProperty("canAccessProject");
    expect(StubAuthContext.prototype).not.toHaveProperty("registerProject");
  });
});
