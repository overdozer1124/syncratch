import {describe, expect, it} from "vitest";
import {
  emailDomain,
  isStudentEmailDomainAllowed,
  normalizeAllowedEmailDomains,
  normalizeGoogleEmail,
  normalizeStudentAuthMethod,
  parseAllowedEmailDomainsJson,
  studentAuthMethodIncludesGoogle,
  studentAuthMethodIncludesLocal,
} from "./roster-auth.js";

describe("normalizeGoogleEmail", () => {
  it("trims and lowercases valid emails", () => {
    expect(normalizeGoogleEmail("  Alice@School.JP  ")).toBe("alice@school.jp");
  });

  it("returns null for empty or invalid values", () => {
    expect(normalizeGoogleEmail("")).toBeNull();
    expect(normalizeGoogleEmail("   ")).toBeNull();
    expect(normalizeGoogleEmail(null)).toBeNull();
    expect(normalizeGoogleEmail("not-an-email")).toBeNull();
  });
});

describe("normalizeStudentAuthMethod", () => {
  it("accepts known methods", () => {
    expect(normalizeStudentAuthMethod("google")).toBe("google");
    expect(normalizeStudentAuthMethod("local")).toBe("local");
    expect(normalizeStudentAuthMethod("google-or-local")).toBe("google-or-local");
  });

  it("defaults unknown values to google-or-local", () => {
    expect(normalizeStudentAuthMethod("magic-link")).toBe("google-or-local");
    expect(normalizeStudentAuthMethod(undefined)).toBe("google-or-local");
  });
});

describe("normalizeAllowedEmailDomains", () => {
  it("deduplicates and strips leading @", () => {
    expect(normalizeAllowedEmailDomains(["@School.JP", "school.jp", "  "])).toEqual([
      "school.jp",
    ]);
  });

  it("returns empty array for non-array input", () => {
    expect(normalizeAllowedEmailDomains(null)).toEqual([]);
  });
});

describe("parseAllowedEmailDomainsJson", () => {
  it("parses JSON arrays", () => {
    expect(parseAllowedEmailDomainsJson('["@example.com"]')).toEqual(["example.com"]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseAllowedEmailDomainsJson("{bad")).toEqual([]);
    expect(parseAllowedEmailDomainsJson("")).toEqual([]);
  });
});

describe("isStudentEmailDomainAllowed", () => {
  it("allows any domain when list is empty", () => {
    expect(isStudentEmailDomainAllowed("a@gmail.com", [])).toBe(true);
  });

  it("matches exact domain only", () => {
    expect(isStudentEmailDomainAllowed("a@school.jp", ["school.jp"])).toBe(true);
    expect(isStudentEmailDomainAllowed("a@sub.school.jp", ["school.jp"])).toBe(false);
  });
});

describe("emailDomain", () => {
  it("extracts lowercase domain", () => {
    expect(emailDomain("Alice@School.JP")).toBe("school.jp");
    expect(emailDomain("invalid")).toBeNull();
  });
});

describe("studentAuthMethodIncludes*", () => {
  it("reflects method combinations", () => {
    expect(studentAuthMethodIncludesGoogle("google")).toBe(true);
    expect(studentAuthMethodIncludesGoogle("local")).toBe(false);
    expect(studentAuthMethodIncludesGoogle("google-or-local")).toBe(true);
    expect(studentAuthMethodIncludesLocal("local")).toBe(true);
    expect(studentAuthMethodIncludesLocal("google")).toBe(false);
    expect(studentAuthMethodIncludesLocal("google-or-local")).toBe(true);
  });
});
