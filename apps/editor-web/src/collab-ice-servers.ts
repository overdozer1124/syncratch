/**
 * Parse optional `VITE_COLLAB_ICE_SERVERS` JSON into RTCIceServer[].
 * When unset or invalid, returns undefined so the WebRTC transport uses defaults
 * (STUN + public TURN fallback).
 */
export function parseCollabIceServers(
  raw: string | undefined | null,
): RTCIceServer[] | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    const servers: RTCIceServer[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) return undefined;
      const record = item as Record<string, unknown>;
      const urls = record.urls;
      if (typeof urls !== "string" && !Array.isArray(urls)) return undefined;
      if (Array.isArray(urls) && !urls.every(u => typeof u === "string")) {
        return undefined;
      }
      const server: RTCIceServer = {urls: urls as string | string[]};
      if (typeof record.username === "string") server.username = record.username;
      if (typeof record.credential === "string") {
        server.credential = record.credential;
      }
      servers.push(server);
    }
    return servers;
  } catch {
    return undefined;
  }
}
