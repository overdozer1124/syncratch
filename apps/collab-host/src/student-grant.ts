/**
 * Short-lived HttpOnly student policy grant cookie (separate from admin session).
 */
import {randomBytes} from "node:crypto";
import type {IncomingMessage, ServerResponse} from "node:http";

export const STUDENT_GRANT_COOKIE = "syncratch_student_grant";

/** Default grant lifetime after exchange (8 hours). */
export const STUDENT_GRANT_TTL_MS = 8 * 60 * 60_000;

export interface StudentGrantCookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

export function readStudentGrantId(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${STUDENT_GRANT_COOKIE}=`)) {
      const raw = trimmed.slice(`${STUDENT_GRANT_COOKIE}=`.length);
      try {
        const value = decodeURIComponent(raw);
        return value.trim() || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function setStudentGrantCookie(
  res: ServerResponse,
  grantId: string,
  options: StudentGrantCookieOptions,
): void {
  const parts = [
    `${STUDENT_GRANT_COOKIE}=${encodeURIComponent(grantId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) parts.push("Secure");
  res.setHeader("set-cookie", parts.join("; "));
}

export function clearStudentGrantCookie(
  res: ServerResponse,
  secure: boolean,
): void {
  const parts = [
    `${STUDENT_GRANT_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("set-cookie", parts.join("; "));
}

export function createGrantId(): string {
  return randomBytes(24).toString("base64url");
}
