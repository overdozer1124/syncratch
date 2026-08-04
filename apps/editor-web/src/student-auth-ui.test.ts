import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {
  activateStudentIdentity,
  fetchStudentIdentitySession,
  loginStudentIdentity,
} from "./student-auth-ui.js";

describe("student auth ui api helpers", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ok: true, authenticated: true, studentId: "s1"}),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchStudentIdentitySession returns session on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        authenticated: true,
        studentId: "s1",
        displayName: "Student",
        loginName: "student.one",
      }),
    } as Response);

    await expect(fetchStudentIdentitySession()).resolves.toEqual({
      authenticated: true,
      studentId: "s1",
      displayName: "Student",
      loginName: "student.one",
    });
  });

  it("loginStudentIdentity surfaces server message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ok: false, message: "ログイン情報が正しくありません。"}),
    } as Response);

    await expect(
      loginStudentIdentity({loginName: "x", passphrase: "y"}),
    ).resolves.toEqual({
      ok: false,
      message: "ログイン情報が正しくありません。",
    });
  });

  it("activateStudentIdentity succeeds on 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ok: true}),
    } as Response);

    await expect(
      activateStudentIdentity({
        enrollmentCode: "ABCD1234",
        passphrase: "secret-pass",
      }),
    ).resolves.toEqual({ok: true});
  });
});
