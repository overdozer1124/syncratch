import {describe, expect, it, vi} from "vitest";
import {ROSTER_SHEET_COLUMNS} from "@blocksync/classroom-access";
import {
  buildSheetRangeA1,
  ensureAdminAccessToken,
  fetchSheetValues,
  sheetValuesToParsedRows,
  SheetSyncError,
} from "./roster-sheet-sync.js";
import type {AdminGoogleCredentialStore} from "./admin-google-credential-store.js";
import type {AdminGoogleOAuthConfig} from "./admin-google-oauth.js";

describe("roster-sheet-sync helpers", () => {
  it("builds A1 range with tab and explicit range", () => {
    expect(
      buildSheetRangeA1({
        sheetTabName: "Students",
        sheetRange: "A1:F500",
      }),
    ).toBe("'Students'!A1:F500");
  });

  it("defaults tab range when only tab is set", () => {
    expect(
      buildSheetRangeA1({
        sheetTabName: "Roster",
        sheetRange: null,
      }),
    ).toBe("'Roster'!A1:Z1001");
  });

  it("converts sheet values to parsed rows with header contract", () => {
    const header = [...ROSTER_SHEET_COLUMNS];
    const values = [
      header,
      ["s001", "Alice", "01", "alice", "A", "true"],
      ["s002", "Bob", "", "bob", "", ""],
    ];
    const rows = sheetValuesToParsedRows(values);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.raw.student_code).toBe("s001");
    expect(rows[1]?.raw.display_name).toBe("Bob");
  });

  it("rejects sheet header missing required columns", () => {
    expect(() =>
      sheetValuesToParsedRows([
        ["student_code", "display_name"],
        ["s001", "Alice"],
      ]),
    ).toThrow(SheetSyncError);
  });
});

describe("ensureAdminAccessToken", () => {
  it("refreshes expired access token and persists it", async () => {
    const nowMs = 1_700_000_000_000;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({access_token: "access-new", expires_in: 3600}),
          {status: 200},
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    let storedAccessToken = "access-old";
    let storedExpiresAt = nowMs - 1000;
    const store: AdminGoogleCredentialStore = {
      putPendingOAuth: () => {},
      takePendingOAuth: () => null,
      purgeExpiredPendingOAuth: () => 0,
      upsertCredential: () => {
        throw new Error("not used");
      },
      getCredentialByAdminId: () => ({
        credentialId: "agc_test",
        adminId: "admin-1",
        googleSubject: "sub",
        googleEmail: "teacher@school.example",
        scope: "drive.file",
        refreshToken: "refresh-1",
        accessToken: storedAccessToken,
        accessExpiresAt: storedExpiresAt,
        createdAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
      }),
      deleteCredentialByAdminId: () => false,
      updateAccessToken: (_id, accessToken, accessExpiresAt) => {
        storedAccessToken = accessToken ?? "";
        storedExpiresAt = accessExpiresAt ?? nowMs;
      },
    };

    const oauthConfig: AdminGoogleOAuthConfig = {
      clientId: "client",
      clientSecret: "secret",
      now: () => nowMs,
      fetch: fetchMock,
    };

    const result = await ensureAdminAccessToken(
      {oauthConfig, credentialStore: store, fetch: fetchMock},
      "admin-1",
    );
    expect(result.accessToken).toBe("access-new");
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("fetchSheetValues", () => {
  it("maps 403/404 to SHEET_INACCESSIBLE", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", {status: 403})) as typeof fetch;
    await expect(
      fetchSheetValues(
        {
          oauthConfig: {clientId: "c", clientSecret: "s"},
          credentialStore: {} as AdminGoogleCredentialStore,
          fetch: fetchMock,
        },
        "token",
        {
          sheetSpreadsheetId: "sheet-1",
          sheetTabName: "Roster",
          sheetRange: null,
        },
      ),
    ).rejects.toMatchObject({code: "SHEET_INACCESSIBLE"});
  });
});
