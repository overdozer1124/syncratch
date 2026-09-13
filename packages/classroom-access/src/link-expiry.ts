/** Parse optional link expiry from admin API input. */
export function parseLinkExpiresAt(
  value: unknown,
): {ok: true; expiresAt: string | null} | {ok: false; code: "INVALID_EXPIRES_AT"} {
  if (value === null || value === undefined || value === "") {
    return {ok: true, expiresAt: null};
  }
  if (typeof value !== "string") {
    return {ok: false, code: "INVALID_EXPIRES_AT"};
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return {ok: false, code: "INVALID_EXPIRES_AT"};
  }
  return {ok: true, expiresAt: new Date(ms).toISOString()};
}

export function isLinkExpiresAtInPast(expiresAt: string, nowIso: string): boolean {
  return expiresAt <= nowIso;
}
