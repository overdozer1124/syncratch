/**
 * Resolve ICE servers for collaboration:
 * 1. `VITE_COLLAB_ICE_SERVERS` JSON override (dedicated TURN)
 * 2. Same-origin `GET /ice` (collab-host minted Open Relay HMAC)
 * 3. Client-minted Open Relay HMAC (`createOpenRelayIceServers`)
 */
import {createOpenRelayIceServers} from "@blocksync/collab-webrtc";

/**
 * Parse optional `VITE_COLLAB_ICE_SERVERS` JSON into RTCIceServer[].
 * When unset or invalid, returns undefined so callers fall through to Open Relay.
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

function isIceServerArray(value: unknown): value is RTCIceServer[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(item => {
    if (typeof item !== "object" || item === null) return false;
    const urls = (item as {urls?: unknown}).urls;
    return typeof urls === "string" || Array.isArray(urls);
  });
}

/** Fetch same-origin `/ice` credentials minted by collab-host. */
export async function fetchHostIceServers(
  fetchImpl: typeof fetch = fetch,
  origin: string = typeof location !== "undefined" ? location.origin : "",
): Promise<RTCIceServer[] | undefined> {
  if (!origin) return undefined;
  try {
    const response = await fetchImpl(new URL("/ice", origin).toString(), {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {iceServers?: unknown};
    if (!isIceServerArray(body.iceServers)) return undefined;
    return body.iceServers;
  } catch {
    return undefined;
  }
}

export async function resolveCollabIceServers(options: {
  envIceServers?: RTCIceServer[];
  userId: string;
  fetchImpl?: typeof fetch;
  origin?: string;
  createOpenRelay?: typeof createOpenRelayIceServers;
}): Promise<RTCIceServer[]> {
  if (options.envIceServers && options.envIceServers.length > 0) {
    return options.envIceServers;
  }
  const fromHost = await fetchHostIceServers(
    options.fetchImpl,
    options.origin,
  );
  if (fromHost) return fromHost;
  const mint = options.createOpenRelay ?? createOpenRelayIceServers;
  return mint({userId: options.userId});
}
