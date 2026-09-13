import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {
  STUDENT_AUTH_GOOGLE_RETURN_FLAG,
  STUDENT_AUTH_GOOGLE_RETURN_REASON,
  STUDENT_AUTH_GOOGLE_START_PATH,
} from "@blocksync/classroom-access";
import {
  activateStudentIdentity,
  buildStudentGoogleOAuthStartUrl,
  consumeStudentGoogleOAuthReturn,
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

  it("buildStudentGoogleOAuthStartUrl encodes return path", () => {
    vi.stubGlobal("window", {location: {origin: "https://example.test"}});
    expect(buildStudentGoogleOAuthStartUrl("/s/abc")).toBe(
      `${STUDENT_AUTH_GOOGLE_START_PATH}?return=%2Fs%2Fabc`,
    );
    vi.unstubAllGlobals();
  });

  it("consumeStudentGoogleOAuthReturn strips query params", () => {
    vi.stubGlobal("window", {
      location: {
        pathname: "/",
        search: `?${STUDENT_AUTH_GOOGLE_RETURN_FLAG}=ok&${STUDENT_AUTH_GOOGLE_RETURN_REASON}=none`,
        hash: "",
      },
      history: {replaceState: vi.fn()},
    });
    expect(consumeStudentGoogleOAuthReturn()).toEqual({ok: true, reason: "none"});
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/");
    vi.unstubAllGlobals();
  });
});
