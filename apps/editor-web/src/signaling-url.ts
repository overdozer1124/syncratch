/**
 * Resolve the browser signaling WebSocket URL from build-time configuration.
 *
 * - Explicit `ws://` / `wss://` values pass through unchanged.
 * - The sentinel `same-origin` (used by Railway collab-host) becomes
 *   `wss://<host>/signal` or `ws://<host>/signal` from the page location.
 * - Empty / missing values leave collaboration disabled (no public fallback).
 */
export const SAME_ORIGIN_SIGNALING = "same-origin";
export const SAME_ORIGIN_SIGNALING_PATH = "/signal";

export type SignalingLocationLike = Pick<Location, "protocol" | "host">;

export function resolveCollabSignalingUrl(
  configured: string | undefined | null,
  locationLike?: SignalingLocationLike | null,
): string {
  const trimmed = configured?.trim() ?? "";
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed !== SAME_ORIGIN_SIGNALING) {
    return trimmed;
  }
  const loc =
    locationLike ??
    (typeof globalThis !== "undefined" && "location" in globalThis
      ? (globalThis as {location?: SignalingLocationLike}).location
      : null);
  if (!loc?.host) {
    return "";
  }
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}${SAME_ORIGIN_SIGNALING_PATH}`;
}
