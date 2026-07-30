/** Normalize emails for allowlist comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Parse `SYNCRATCH_ADMIN_EMAILS` CSV allowlist.
 * Empty / missing → no admins (login always denied).
 */
export function parseAdminEmailAllowlist(
  raw: string | undefined | null,
): Set<string> {
  const set = new Set<string>();
  if (!raw) return set;
  for (const part of raw.split(/[,;\s]+/)) {
    const email = normalizeEmail(part);
    if (email.includes("@")) set.add(email);
  }
  return set;
}

export function isEmailAllowlisted(
  email: string | undefined | null,
  allowlist: Set<string>,
): boolean {
  if (!email) return false;
  return allowlist.has(normalizeEmail(email));
}
