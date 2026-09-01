import {normalizeEmail} from "./email.js";
import type {StudentAuthMethod} from "./roster-types.js";

const STUDENT_AUTH_METHODS: readonly StudentAuthMethod[] = [
  "google",
  "local",
  "google-or-local",
];

/** Normalize a roster Sheet / API google_email value (empty → null). */
export function normalizeGoogleEmail(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = normalizeEmail(trimmed);
  return normalized.includes("@") ? normalized : null;
}

export function normalizeStudentAuthMethod(value: unknown): StudentAuthMethod {
  if (
    typeof value === "string" &&
    (STUDENT_AUTH_METHODS as readonly string[]).includes(value)
  ) {
    return value as StudentAuthMethod;
  }
  return "google-or-local";
}

/** Normalize admin-configured allowed email domains (empty list = no restriction). */
export function normalizeAllowedEmailDomains(
  value: unknown,
): readonly string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().toLowerCase().replace(/^@+/, "");
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function parseAllowedEmailDomainsJson(raw: string | null | undefined): readonly string[] {
  if (!raw?.trim()) return [];
  try {
    return normalizeAllowedEmailDomains(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/** Extract lowercase domain part from an email address. */
export function emailDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  return normalized.slice(at + 1);
}

/**
 * Check whether a login email satisfies classroom allowedEmailDomains.
 * Empty allowed list → always true (free tier / no domain lock).
 * Domain match is exact on the `@` suffix (m-google-1: no implicit subdomain roll-up).
 */
export function isStudentEmailDomainAllowed(
  email: string,
  allowedEmailDomains: readonly string[],
): boolean {
  if (allowedEmailDomains.length === 0) return true;
  const domain = emailDomain(email);
  if (!domain) return false;
  return allowedEmailDomains.includes(domain);
}

export function studentAuthMethodIncludesGoogle(method: StudentAuthMethod): boolean {
  return method === "google" || method === "google-or-local";
}

export function studentAuthMethodIncludesLocal(method: StudentAuthMethod): boolean {
  return method === "local" || method === "google-or-local";
}

/** 6-digit roster ID: {YY}{grade}{class}{attendance2digits}, e.g. 261101. */
export const ROSTER_STUDENT_CODE_PATTERN = /^\d{6}$/;

export function isCanonicalRosterStudentCode(code: string): boolean {
  return ROSTER_STUDENT_CODE_PATTERN.test(code.trim());
}
