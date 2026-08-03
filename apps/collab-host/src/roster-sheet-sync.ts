/**
 * Google Sheet roster sync — manual pull via teacher credential (PR 4).
 */
import {
  ROSTER_SHEET_COLUMNS,
  type ClassroomRoster,
} from "@blocksync/classroom-access";
import type {
  AdminGoogleCredentialRecord,
  AdminGoogleCredentialStore,
} from "./admin-google-credential-store.js";
import type {AdminGoogleOAuthConfig} from "./admin-google-oauth.js";
import {
  MAX_ROSTER_CSV_ROWS,
  type ParsedRosterCsvRow,
} from "./roster-import.js";

const ACCESS_SKEW_MS = 60_000;
export {ACCESS_SKEW_MS};
const SHEETS_VALUES_URL =
  "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetSyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SheetSyncError";
  }
}

export interface RosterSheetSyncEnvironment {
  oauthConfig: AdminGoogleOAuthConfig;
  credentialStore: AdminGoogleCredentialStore;
  fetch?: typeof fetch;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function escapeSheetTabName(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

export function buildSheetRangeA1(input: {
  sheetTabName: string | null;
  sheetRange: string | null;
}): string {
  const dataRange = "A1:Z1001";
  if (input.sheetTabName && input.sheetRange) {
    return `${escapeSheetTabName(input.sheetTabName)}!${input.sheetRange}`;
  }
  if (input.sheetTabName) {
    return `${escapeSheetTabName(input.sheetTabName)}!${dataRange}`;
  }
  if (input.sheetRange) {
    return input.sheetRange;
  }
  return dataRange;
}

export function sheetValuesToParsedRows(values: string[][]): ParsedRosterCsvRow[] {
  if (values.length === 0) {
    return [];
  }
  const header = values[0] ?? [];
  const headerKeys = header.map(cell => cell.trim());
  const parsed: ParsedRosterCsvRow[] = [];

  for (let index = 1; index < values.length; index++) {
    const row = values[index] ?? [];
    const raw: Record<string, string> = {};
    let nonEmpty = false;
    for (let col = 0; col < headerKeys.length; col++) {
      const key = headerKeys[col];
      if (!key) continue;
      const value = row[col] ?? "";
      if (value.trim() !== "") nonEmpty = true;
      raw[key] = value;
    }
    if (!nonEmpty) continue;
    parsed.push({rowNumber: index + 1, raw});
    if (parsed.length > MAX_ROSTER_CSV_ROWS) {
      throw new SheetSyncError(
        "SHEET_TOO_LARGE",
        `Sheet exceeds ${MAX_ROSTER_CSV_ROWS} data rows`,
      );
    }
  }

  const missingRequired = ROSTER_SHEET_COLUMNS.filter(
    column => !headerKeys.includes(column),
  );
  if (missingRequired.length > 0) {
    throw new SheetSyncError(
      "SHEET_HEADER_INVALID",
      `Sheet header missing required columns: ${missingRequired.join(", ")}`,
    );
  }

  return parsed;
}

async function exchangeRefreshToken(
  fetchImpl: typeof fetch,
  oauthConfig: AdminGoogleOAuthConfig,
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    throw new SheetSyncError(
      "CREDENTIAL_REFRESH_FAILED",
      json.error_description || json.error || "token refresh failed",
    );
  }
  return json;
}

export async function ensureAdminAccessToken(
  env: RosterSheetSyncEnvironment,
  adminId: string,
): Promise<{accessToken: string; credential: AdminGoogleCredentialRecord}> {
  const credential = env.credentialStore.getCredentialByAdminId(adminId);
  if (!credential) {
    throw new SheetSyncError(
      "CREDENTIAL_MISSING",
      "Teacher Google credential is not connected",
    );
  }

  const fetchImpl = env.fetch ?? fetch;
  const nowMs = env.oauthConfig.now?.() ?? Date.now();
  if (
    credential.accessToken &&
    credential.accessExpiresAt != null &&
    credential.accessExpiresAt > nowMs + ACCESS_SKEW_MS
  ) {
    return {accessToken: credential.accessToken, credential};
  }

  const token = await exchangeRefreshToken(
    fetchImpl,
    env.oauthConfig,
    credential.refreshToken,
  );
  if (!token.access_token) {
    throw new SheetSyncError(
      "CREDENTIAL_REFRESH_FAILED",
      "Google did not return an access token",
    );
  }
  const expiresInSec = Number(token.expires_in) || 3600;
  const expiresAt = nowMs + expiresInSec * 1000;
  env.credentialStore.updateAccessToken(
    credential.credentialId,
    token.access_token,
    expiresAt,
    new Date(nowMs).toISOString(),
  );
  const refreshed = env.credentialStore.getCredentialByAdminId(adminId);
  if (!refreshed?.accessToken) {
    throw new SheetSyncError(
      "CREDENTIAL_REFRESH_FAILED",
      "Failed to persist refreshed access token",
    );
  }
  return {accessToken: refreshed.accessToken, credential: refreshed};
}

export async function fetchSheetValues(
  env: RosterSheetSyncEnvironment,
  accessToken: string,
  roster: Pick<
    ClassroomRoster,
    "sheetSpreadsheetId" | "sheetTabName" | "sheetRange"
  >,
): Promise<string[][]> {
  if (!roster.sheetSpreadsheetId) {
    throw new SheetSyncError(
      "SHEET_NOT_BOUND",
      "Roster is not bound to a Google Sheet",
    );
  }

  const fetchImpl = env.fetch ?? fetch;
  const rangeA1 = buildSheetRangeA1({
    sheetTabName: roster.sheetTabName,
    sheetRange: roster.sheetRange,
  });
  const url = `${SHEETS_VALUES_URL}/${encodeURIComponent(roster.sheetSpreadsheetId)}/values/${encodeURIComponent(rangeA1)}`;
  const response = await fetchImpl(url, {
    headers: {authorization: `Bearer ${accessToken}`},
  });

  if (response.status === 403 || response.status === 404) {
    throw new SheetSyncError(
      "SHEET_INACCESSIBLE",
      "Google Sheet is inaccessible; re-select the sheet",
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: {message?: string};
    };
    throw new SheetSyncError(
      "SHEET_FETCH_FAILED",
      body.error?.message || `Sheet fetch failed (${response.status})`,
    );
  }

  const json = (await response.json()) as {values?: string[][]};
  return json.values ?? [];
}

export async function pullSheetParsedRows(
  env: RosterSheetSyncEnvironment,
  adminId: string,
  roster: ClassroomRoster,
): Promise<ParsedRosterCsvRow[]> {
  const {accessToken} = await ensureAdminAccessToken(env, adminId);
  const values = await fetchSheetValues(env, accessToken, roster);
  return sheetValuesToParsedRows(values);
}
