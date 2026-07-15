import { ForbiddenError } from "@blocksync/project-service";

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin || origin === "null") return false;
  return allowedOrigins.includes(origin);
}

/** Missing / null / disallowed Origin → 403. */
export function assertOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): string {
  if (!isOriginAllowed(origin, allowedOrigins)) {
    throw new ForbiddenError("Origin not allowed");
  }
  return origin!;
}
