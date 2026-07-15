import { ForbiddenError } from "@blocksync/project-service";
import type { AuthRepository } from "@blocksync/session-service";
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "./cookies.js";

export interface AssertCsrfInput {
  cookies: Record<string, string | undefined>;
  csrfHeader: string | undefined;
  authRepo: AuthRepository;
  hash: (raw: string) => string;
}

/**
 * Requires all of: CSRF cookie, X-CSRF-Token header, equal values,
 * and sha256(header) === sessions.csrf_hash. Else 403.
 */
export function assertCsrf(input: AssertCsrfInput): void {
  const cookieVal = input.cookies[CSRF_COOKIE_NAME];
  if (!cookieVal) {
    throw new ForbiddenError("CSRF cookie required");
  }
  const headerVal = input.csrfHeader?.trim();
  if (!headerVal) {
    throw new ForbiddenError("X-CSRF-Token required");
  }
  if (cookieVal !== headerVal) {
    throw new ForbiddenError("CSRF mismatch");
  }

  const rawSession = input.cookies[SESSION_COOKIE_NAME];
  if (!rawSession) {
    throw new ForbiddenError("CSRF session missing");
  }
  const idHash = input.hash(rawSession);
  const row = input.authRepo.withTransaction((tx) => tx.getSessionByHash(idHash));
  if (!row || row.csrfHash !== input.hash(headerVal)) {
    throw new ForbiddenError("CSRF invalid");
  }
}
