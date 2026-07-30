import {describe, expect, it} from "vitest";
import {
  createStudentLinkToken,
  isEmailAllowlisted,
  isPlausibleStudentToken,
  normalizeClassroomPolicyInput,
  parseAdminEmailAllowlist,
  resolveSurfaceMode,
  toStudentPolicyView,
  type ClassroomPolicy,
} from "./index.js";

function fixedRandom(seed: number): (length: number) => Uint8Array {
  return (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = (seed + i * 17) & 0xff;
    return out;
  };
}

describe("resolveSurfaceMode", () => {
  it("maps /admin and /s/{token}", () => {
    expect(resolveSurfaceMode("/admin")).toEqual({kind: "admin"});
    expect(resolveSurfaceMode("/admin/")).toEqual({kind: "admin"});
    const token = createStudentLinkToken(fixedRandom(3));
    expect(resolveSurfaceMode(`/s/${token}`)).toEqual({
      kind: "student",
      token,
    });
  });

  it("keeps community for root and rejects short tokens", () => {
    expect(resolveSurfaceMode("/")).toEqual({kind: "community"});
    expect(resolveSurfaceMode("/s/short")).toEqual({kind: "community"});
    expect(resolveSurfaceMode("/alice")).toEqual({kind: "community"});
  });

  it("strips BASE_PATH", () => {
    expect(resolveSurfaceMode("/app/admin", "/app")).toEqual({kind: "admin"});
  });
});

describe("createStudentLinkToken", () => {
  it("is deterministic for fixed entropy and plausible", () => {
    const a = createStudentLinkToken(fixedRandom(1));
    const b = createStudentLinkToken(fixedRandom(1));
    expect(a).toBe(b);
    expect(isPlausibleStudentToken(a)).toBe(true);
  });
});

describe("policy normalize + student view", () => {
  it("defaults AI off and strips privileged fields", () => {
    const normalized = normalizeClassroomPolicyInput({});
    expect(normalized.aiAssist.enabled).toBe(false);
    expect(normalized.aiAssist.allowStudentApiKey).toBe(false);
    expect(normalized.editor.showSettingsPanel).toBe(false);

    const policy: ClassroomPolicy = {
      policyId: "p1",
      ownerAdminId: "a1",
      createdAt: "t0",
      updatedAt: "t1",
      ...normalized,
    };
    const view = toStudentPolicyView(policy);
    expect(view).not.toHaveProperty("ownerAdminId");
    expect(view).not.toHaveProperty("status");
    expect(view.aiAssist.enabled).toBe(false);
  });
});

describe("admin email allowlist", () => {
  it("parses CSV and matches normalized emails", () => {
    const list = parseAdminEmailAllowlist("Alice@Example.com, bob@school.jp");
    expect(isEmailAllowlisted("alice@example.com", list)).toBe(true);
    expect(isEmailAllowlisted("carol@example.com", list)).toBe(false);
    expect(parseAdminEmailAllowlist("").size).toBe(0);
  });
});
