import {describe, expect, it} from "vitest";
import {
  createStudentLinkToken,
  isEmailAllowlisted,
  isPlausibleStudentToken,
  normalizeClassroomPolicyInput,
  parseAdminEmailAllowlist,
  resolveStudentAccessMode,
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
  it("maps /admin, /s, and /s/{token}", () => {
    expect(resolveSurfaceMode("/admin")).toEqual({kind: "admin"});
    expect(resolveSurfaceMode("/admin/")).toEqual({kind: "admin"});
    expect(resolveSurfaceMode("/s")).toEqual({kind: "student"});
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
    expect(normalized.editor.allowExtensions).toBe(false);
    expect(normalized.rosterId).toBeNull();
    expect(normalized.studentAuth.required).toBe(false);
    expect(normalized.submission.enabled).toBe(false);

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
    expect(view).not.toHaveProperty("rosterId");
    expect(view.aiAssist.enabled).toBe(false);
    expect(view.studentAuth.required).toBe(false);
    expect(view.submission.enabled).toBe(false);
  });

  it("resolveStudentAccessMode gates roster-login on rosterId + required auth", () => {
    expect(
      resolveStudentAccessMode({
        rosterId: null,
        studentAuth: {required: false},
      }),
    ).toBe("shared-anonymous");
    expect(
      resolveStudentAccessMode({
        rosterId: "r1",
        studentAuth: {required: false},
      }),
    ).toBe("shared-anonymous");
    expect(
      resolveStudentAccessMode({
        rosterId: "r1",
        studentAuth: {required: true},
      }),
    ).toBe("roster-login");
    expect(
      resolveStudentAccessMode(
        {rosterId: "r1", studentAuth: {required: true}},
        {classroomRosterEnabled: false},
      ),
    ).toBe("shared-anonymous");
  });

  it("toStudentPolicyView forces studentAuth.required false when roster flag off", () => {
    const policy: ClassroomPolicy = {
      policyId: "p1",
      ownerAdminId: "a1",
      createdAt: "t0",
      updatedAt: "t1",
      ...normalizeClassroomPolicyInput({
        rosterId: "r1",
        studentAuth: {required: true},
      }),
    };
    const view = toStudentPolicyView(policy, {classroomRosterEnabled: false});
    expect(view).not.toHaveProperty("rosterId");
    expect(view.studentAuth.required).toBe(false);
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
