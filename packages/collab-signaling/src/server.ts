/**
 * Minimal deployable signaling server built on `ws`. It wraps SignalingHub and
 * adds transport concerns only: connection ids, idle sweeping, and limits. It
 * remains stateless/ephemeral — no Yjs updates or project snapshots at rest.
 *
 * Free-tier deployment: the same routing logic maps directly onto a Cloudflare
 * Worker + Durable Object (one DO instance per topic acting as the relay).
 * See README for deployment notes. TURN may still be required on restrictive
 * (e.g. school) networks; this service does not provide TURN.
 *
 * Same-origin hosting (e.g. Railway): pass `httpServer` + `path` (default
 * `/signal`) to attach the WebSocket upgrade to an existing HTTP listener that
 * also serves the editor static files.
 */
import type {Server as HttpServer} from "node:http";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {WebSocketServer, type WebSocket} from "ws";
import {
  DEFAULT_SIGNALING_LIMITS,
  SignalingHub,
  type SignalingConnection,
  type SignalingHubOptions,
} from "./hub.js";

/** Default upgrade path when attaching to an HTTP server (Railway collab-host). */
export const DEFAULT_SIGNALING_PATH = "/signal";

export interface StartSignalingServerOptions extends SignalingHubOptions {
  port?: number;
  host?: string;
  sweepIntervalMs?: number;
  /**
   * Attach to an existing HTTP(S) server instead of opening a dedicated
   * WebSocket listener. Caller owns `listen()` / `close()` on this server.
   */
  httpServer?: HttpServer;
  /** WebSocket upgrade path when `httpServer` is set. */
  path?: string;
}

export interface SignalingServerHandle {
  wss: WebSocketServer;
  port: number;
  url: string;
  path: string | null;
  hub: SignalingHub;
  close: () => Promise<void>;
}

function wireHub(wss: WebSocketServer, hub: SignalingHub): void {
  let nextId = 0;
  wss.on("connection", (ws: WebSocket) => {
    const conn: SignalingConnection = {
      id: `c${(nextId += 1)}`,
      send: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason),
    };
    hub.handleConnection(conn);
    ws.on("message", (data) => {
      const raw = Array.isArray(data)
        ? Buffer.concat(data.map((d) => Buffer.from(d)))
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : (data as Buffer);
      hub.handleMessage(conn, raw);
    });
    ws.on("close", () => hub.handleClose(conn));
    ws.on("error", () => hub.handleClose(conn));
  });
}

function wsUrlForHttpServer(
  httpServer: HttpServer,
  path: string,
  fallbackHost: string,
): {port: number; url: string} {
  const address = httpServer.address();
  if (typeof address === "object" && address) {
    const host =
      address.address === "::" || address.address === "0.0.0.0"
        ? fallbackHost
        : address.address;
    return {port: address.port, url: `ws://${host}:${address.port}${path}`};
  }
  return {port: 0, url: `ws://${fallbackHost}${path}`};
}

export async function startSignalingServer(
  options: StartSignalingServerOptions = {},
): Promise<SignalingServerHandle> {
  const port = options.port ?? 0;
  const host = options.host ?? "127.0.0.1";
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_SIGNALING_LIMITS.maxMessageBytes;
  const hub = new SignalingHub(options);
  const path = options.httpServer
    ? (options.path?.trim() || DEFAULT_SIGNALING_PATH)
    : null;

  let wss: WebSocketServer;
  let resolvedPort: number;
  let url: string;

  if (options.httpServer) {
    wss = new WebSocketServer({
      server: options.httpServer,
      path: path!,
      maxPayload: maxMessageBytes,
    });
    wireHub(wss, hub);
    const resolved = wsUrlForHttpServer(options.httpServer, path!, host);
    resolvedPort = resolved.port;
    url = resolved.url;
  } else {
    wss = await new Promise<WebSocketServer>((resolve, reject) => {
      const server = new WebSocketServer({host, port, maxPayload: maxMessageBytes});
      server.once("listening", () => resolve(server));
      server.once("error", reject);
    });
    wireHub(wss, hub);
    const address = wss.address();
    resolvedPort = typeof address === "object" && address ? address.port : port;
    url = `ws://${host}:${resolvedPort}`;
  }

  const sweepIntervalMs = options.sweepIntervalMs ?? 15_000;
  const timer = setInterval(() => hub.sweepIdle(), sweepIntervalMs);
  timer.unref?.();

  return {
    wss,
    hub,
    path,
    port: resolvedPort,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(timer);
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  const listenPort = Number(process.env.PORT ?? 4444);
  const handle = await startSignalingServer({port: listenPort});
  console.log(`[collab-signaling] listening on ${handle.url}`);
}
