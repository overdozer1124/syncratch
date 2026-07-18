/**
 * Minimal deployable signaling server built on `ws`. It wraps SignalingHub and
 * adds transport concerns only: connection ids, idle sweeping, and limits. It
 * remains stateless/ephemeral — no Yjs updates or project snapshots at rest.
 *
 * Free-tier deployment: the same routing logic maps directly onto a Cloudflare
 * Worker + Durable Object (one DO instance per topic acting as the relay).
 * See README for deployment notes. TURN may still be required on restrictive
 * (e.g. school) networks; this service does not provide TURN.
 */
import {WebSocketServer, type WebSocket} from "ws";
import {
  DEFAULT_SIGNALING_LIMITS,
  SignalingHub,
  type SignalingConnection,
  type SignalingHubOptions,
} from "./hub.js";

export interface StartSignalingServerOptions extends SignalingHubOptions {
  port?: number;
  host?: string;
  sweepIntervalMs?: number;
}

export interface SignalingServerHandle {
  wss: WebSocketServer;
  port: number;
  url: string;
  hub: SignalingHub;
  close: () => Promise<void>;
}

export async function startSignalingServer(
  options: StartSignalingServerOptions = {},
): Promise<SignalingServerHandle> {
  const port = options.port ?? 0;
  const host = options.host ?? "127.0.0.1";
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_SIGNALING_LIMITS.maxMessageBytes;
  const hub = new SignalingHub(options);

  const wss = await new Promise<WebSocketServer>((resolve, reject) => {
    const server = new WebSocketServer({host, port, maxPayload: maxMessageBytes});
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });

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

  const sweepIntervalMs = options.sweepIntervalMs ?? 15_000;
  const timer = setInterval(() => hub.sweepIdle(), sweepIntervalMs);
  timer.unref?.();

  const address = wss.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    wss,
    hub,
    port: resolvedPort,
    url: `ws://${host}:${resolvedPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(timer);
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const isDirectRun =
  process.argv[1]?.includes("server.ts") || process.argv[1]?.includes("server.js");

if (isDirectRun) {
  const listenPort = Number(process.env.PORT ?? 4444);
  const handle = await startSignalingServer({port: listenPort});
  console.log(`[collab-signaling] listening on ${handle.url}`);
}
