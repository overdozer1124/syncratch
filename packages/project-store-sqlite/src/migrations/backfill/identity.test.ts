import {describe, expect, it} from "vitest";
import {
  R1_LEGACY_BACKFILL_NAMESPACE,
  assertCanonicalUtc,
  laterCanonicalUtc,
  legacyPersonAccountLinkId,
  legacyPersonDisplayName,
  legacyPersonId,
  legacyProjectRoleAssignmentId,
  legacyWorkspaceMembershipId,
  legacyWorkspaceRoleAssignmentId,
  uuidv5,
} from "./identity.js";

describe("legacy backfill deterministic identity", () => {
  it("freezes the R1 legacy namespace", () => {
    expect(
      uuidv5(
        "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
        "https://blocksync.dev/namespaces/r1-legacy-backfill",
      ),
    ).toBe("5382ca4a-3efd-5013-bbff-25dc72876ebf");
    expect(R1_LEGACY_BACKFILL_NAMESPACE).toBe(
      "5382ca4a-3efd-5013-bbff-25dc72876ebf",
    );
  });

  it("freezes every legacy identity name format", () => {
    expect(legacyPersonId("user-1")).toBe(
      "0caeccdd-8df5-5682-9112-2f77411c7e69",
    );
    expect(legacyPersonAccountLinkId("user-1")).toBe(
      "f917e21d-b361-56b2-8cf2-ae463d03d54c",
    );
    expect(legacyWorkspaceMembershipId("org-1", "user-1")).toBe(
      "5f6fa498-0668-583f-8927-fdc3b3222d47",
    );
    expect(
      legacyWorkspaceRoleAssignmentId("org-1", "user-1", "admin"),
    ).toBe("cac163a5-1cba-56d0-babe-289576604073");

    const projectRoleVectors = {
      owner: "0bfb42a1-6055-51ef-85c0-a08764889681",
      host: "ebe958b9-889d-58cf-b6ff-ae77837c4883",
      editor: "a4bb6f11-6eb5-501c-8513-a4666e3f8e75",
      commenter: "2339f2cd-7f67-5aab-b188-b0a271ae8bec",
      viewer: "3d7e03a7-dc31-5c71-b590-0eeeb1cdff3a",
    } as const;

    for (const [role, expected] of Object.entries(projectRoleVectors)) {
      expect(
        legacyProjectRoleAssignmentId(
          "project-1",
          "user-1",
          role as keyof typeof projectRoleVectors,
        ),
      ).toBe(expected);
    }
  });

  it("preserves UTF-8 bytes and case in names", () => {
    expect(legacyPersonId("ユーザー-Ä")).toBe(
      "7b7c3513-907c-5037-b104-d06b89aa5c47",
    );
    expect(legacyPersonId("ユーザー-ä")).toBe(
      "072e4657-1d51-534d-8c8a-fa28a124cd26",
    );
  });

  it("sets the UUIDv5 version and RFC variant bits", () => {
    const value = uuidv5(R1_LEGACY_BACKFILL_NAMESPACE, "bit-contract");

    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("rejects malformed namespace UUIDs clearly", () => {
    expect(() => uuidv5("not-a-uuid", "name")).toThrow(
      /namespace.*UUID/i,
    );
  });
});

describe("legacy person display name", () => {
  it.each([
    ["  Display Name  ", "person@example.test", "Display Name"],
    ["", "  person@example.test  ", "person@example.test"],
    ["   ", null, "Legacy user"],
    [null, "   ", "Legacy user"],
    [null, null, "Legacy user"],
    ["  利用者  ", "fallback@example.test", "利用者"],
  ] as const)(
    "uses display name, then email, then the literal fallback",
    (displayName, email, expected) => {
      expect(legacyPersonDisplayName(displayName, email)).toBe(expected);
    },
  );
});

describe("canonical UTC timestamps", () => {
  it.each([
    "2026-07-18T00:00:00.000Z",
    "2000-02-29T23:59:59.999Z",
    "0000-01-01T00:00:00.000Z",
  ])("accepts canonical UTC value %s", value => {
    expect(() => assertCanonicalUtc(value, "created_at")).not.toThrow();
  });

  it.each([
    "2026-07-18T00:00:00Z",
    "2026-07-18T00:00:00.00Z",
    "2026-07-18T00:00:00.000+00:00",
    "2026-07-18 00:00:00.000Z",
    "2026-7-18T00:00:00.000Z",
    "2026-02-29T00:00:00.000Z",
    "not-a-date",
  ])("rejects non-canonical or invalid UTC value %s clearly", value => {
    expect(() => assertCanonicalUtc(value, "created_at")).toThrow(
      /created_at.*YYYY-MM-DDTHH:MM:SS\.sssZ/,
    );
  });

  it("returns the chronologically later canonical value", () => {
    expect(
      laterCanonicalUtc(
        "2026-07-18T00:00:00.001Z",
        "2026-07-18T00:00:00.000Z",
      ),
    ).toBe("2026-07-18T00:00:00.001Z");
    expect(
      laterCanonicalUtc(
        "2026-07-18T00:00:00.000Z",
        "2026-07-18T00:00:00.001Z",
      ),
    ).toBe("2026-07-18T00:00:00.001Z");
    expect(
      laterCanonicalUtc(
        "2026-07-18T00:00:00.000Z",
        "2026-07-18T00:00:00.000Z",
      ),
    ).toBe("2026-07-18T00:00:00.000Z");
  });

  it("validates both inputs before comparing them", () => {
    expect(() =>
      laterCanonicalUtc(
        "2026-07-18T00:00:00Z",
        "2026-07-18T00:00:00.000Z",
      ),
    ).toThrow(/left.*YYYY-MM-DDTHH:MM:SS\.sssZ/);
    expect(() =>
      laterCanonicalUtc(
        "2026-07-18T00:00:00.000Z",
        "2026-07-18T00:00:00Z",
      ),
    ).toThrow(/right.*YYYY-MM-DDTHH:MM:SS\.sssZ/);
  });
});
