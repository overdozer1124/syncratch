import {createHash} from "node:crypto";

export const R1_LEGACY_BACKFILL_NAMESPACE =
  "5382ca4a-3efd-5013-bbff-25dc72876ebf";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_UTC_FORMAT = "YYYY-MM-DDTHH:MM:SS.sssZ";

export function uuidv5(namespace: string, name: string): string {
  if (!UUID_PATTERN.test(namespace)) {
    throw new Error(`namespace must be a valid UUID: ${namespace}`);
  }

  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const bytes = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function legacyPersonId(userId: string): string {
  return uuidv5(R1_LEGACY_BACKFILL_NAMESPACE, `legacy-user:${userId}`);
}

export function legacyPersonAccountLinkId(userId: string): string {
  return uuidv5(R1_LEGACY_BACKFILL_NAMESPACE, `legacy-link:${userId}`);
}

export function legacyWorkspaceMembershipId(
  organizationId: string,
  userId: string,
): string {
  return uuidv5(
    R1_LEGACY_BACKFILL_NAMESPACE,
    `legacy-wm:${organizationId}:${userId}`,
  );
}

export function legacyWorkspaceRoleAssignmentId(
  organizationId: string,
  userId: string,
  role: "admin" | "member",
): string {
  return uuidv5(
    R1_LEGACY_BACKFILL_NAMESPACE,
    `legacy-ra-ws:${organizationId}:${userId}:${role}`,
  );
}

export function legacyProjectRoleAssignmentId(
  projectId: string,
  userId: string,
  role: "owner" | "host" | "editor" | "commenter" | "viewer",
): string {
  return uuidv5(
    R1_LEGACY_BACKFILL_NAMESPACE,
    `legacy-ra-project:${projectId}:${userId}:${role}`,
  );
}

export function legacyPersonDisplayName(
  displayName: string | null,
  email: string | null,
): string {
  const trimmedDisplayName = displayName?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;

  const trimmedEmail = email?.trim();
  if (trimmedEmail) return trimmedEmail;

  return "Legacy user";
}

export function assertCanonicalUtc(value: string, field: string): void {
  const parsed = Date.parse(value);
  if (
    !CANONICAL_UTC_PATTERN.test(value) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new Error(
      `${field} must be canonical UTC (${CANONICAL_UTC_FORMAT}): ${value}`,
    );
  }
}

export function laterCanonicalUtc(left: string, right: string): string {
  assertCanonicalUtc(left, "left");
  assertCanonicalUtc(right, "right");
  return left >= right ? left : right;
}
