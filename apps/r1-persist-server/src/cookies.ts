export const SESSION_COOKIE_NAME = "blocksync_session";
export const CSRF_COOKIE_NAME = "blocksync_csrf";

/** Absolute session lifetime (7 days), aligned with CSRF cookie Max-Age. */
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export interface CookieAttrOptions {
  secure: boolean;
  maxAgeSec?: number;
}

function baseAttrs(secure: boolean): string {
  const parts = ["Path=/", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildSessionSetCookie(
  value: string,
  opts: CookieAttrOptions,
): string {
  const maxAge = opts.maxAgeSec ?? SESSION_MAX_AGE_SEC;
  return `${SESSION_COOKIE_NAME}=${value}; ${baseAttrs(opts.secure)}; HttpOnly; Max-Age=${maxAge}`;
}

export function buildCsrfSetCookie(
  value: string,
  opts: CookieAttrOptions,
): string {
  const maxAge = opts.maxAgeSec ?? SESSION_MAX_AGE_SEC;
  return `${CSRF_COOKIE_NAME}=${value}; ${baseAttrs(opts.secure)}; Max-Age=${maxAge}`;
}

export function buildSessionClearCookie(secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=; ${baseAttrs(secure)}; HttpOnly; Max-Age=0`;
}

export function buildCsrfClearCookie(secure: boolean): string {
  return `${CSRF_COOKIE_NAME}=; ${baseAttrs(secure)}; Max-Age=0`;
}

export function parseCookieHeader(
  header: string | undefined,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}
