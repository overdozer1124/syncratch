import {describe, expect, it, vi} from "vitest";
import {
  STUDENT_GRANT_PATH,
  STUDENT_POLICY_PATH,
  createStudentLinkToken,
} from "@blocksync/classroom-access";
import {createInvite} from "@blocksync/collab-invite";
import {
  buildStudentAwareInviteUrl,
  exchangeStudentGrant,
  fetchStudentPolicyFromGrant,
  readRememberedStudentLinkToken,
  rememberStudentLinkToken,
  replaceStudentUrlWithoutToken,
} from "./student-surface.js";

describe("student-surface grant flow", () => {
  it("exchanges token for grant and fetches policy", async () => {
    const token = createStudentLinkToken(() => new Uint8Array(16).fill(3));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ok: true}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          policy: {
            policyId: "p1",
            title: "t",
            aiAssist: {enabled: false, level: 2, allowStudentApiKey: false},
            editor: {
              showSettingsPanel: false,
              allowSb3Export: true,
              allowSb3Import: true,
              allowExtensions: false,
            },
            collab: {allow: true},
            drive: {allow: false},
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeStudentGrant(token)).toBe(true);
    const policy = await fetchStudentPolicyFromGrant();
    expect(policy?.policyId).toBe("p1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      STUDENT_GRANT_PATH,
      expect.objectContaining({method: "POST", credentials: "same-origin"}),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      STUDENT_POLICY_PATH,
      expect.objectContaining({credentials: "same-origin"}),
    );
    vi.unstubAllGlobals();
  });

  it("replaces URL with token-less /s while preserving query and hash", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", {replaceState});
    vi.stubGlobal("location", {search: "?x=1", hash: "#invite-abc"});
    replaceStudentUrlWithoutToken("/base");
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/base/s?x=1#invite-abc",
    );
    replaceStudentUrlWithoutToken("/");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/s?x=1#invite-abc");
    vi.unstubAllGlobals();
  });

  it("re-injects remembered classroom token when building collab invite URLs", () => {
    const token = createStudentLinkToken(() => new Uint8Array(16).fill(7));
    const invite = createInvite({
      randomBytes: length => new Uint8Array(length).fill(9),
    });
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      setItem: (key: string, value: string) => storage.set(key, value),
      getItem: (key: string) => storage.get(key) ?? null,
    });
    rememberStudentLinkToken(token);
    expect(readRememberedStudentLinkToken()).toBe(token);

    const url = buildStudentAwareInviteUrl(
      "https://syncratch.example/s",
      invite,
      "/",
    );
    expect(url).toContain(`/s/${encodeURIComponent(token)}#`);
    expect(url).toContain("blocksync-collab=");
    vi.unstubAllGlobals();
  });
});
