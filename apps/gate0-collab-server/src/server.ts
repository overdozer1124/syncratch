/**
 * Minimal room-based Yjs update relay over WebSocket.
 * Protocol (Gate 0): JSON messages
 *  { type: "join", room: string }
 *  { type: "sync", room: string, update: number[] }
 */
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";

export interface StartServerOptions {
  port?: number;
  host?: string;
}

type Client = WebSocket & { room?: string };

export interface CollabServerHandle {
  wss: WebSocketServer;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startCollabServer(
  options: StartServerOptions = {},
): Promise<CollabServerHandle> {
  const port = options.port ?? 0;
  const host = options.host ?? "127.0.0.1";
  const rooms = new Map<string, { doc: Y.Doc; clients: Set<Client> }>();

  const wss = await new Promise<WebSocketServer>((resolve, reject) => {
    const server = new WebSocketServer({ host, port });
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });

  wss.on("connection", (ws: Client) => {
    ws.on("message", (data) => {
      let msg: { type: string; room?: string; update?: number[] };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === "join" && msg.room) {
        ws.room = msg.room;
        let room = rooms.get(msg.room);
        if (!room) {
          room = { doc: new Y.Doc(), clients: new Set() };
          rooms.set(msg.room, room);
        }
        room.clients.add(ws);
        const state = Y.encodeStateAsUpdate(room.doc);
        ws.send(
          JSON.stringify({
            type: "sync",
            room: msg.room,
            update: Array.from(state),
          }),
        );
        return;
      }
      if (msg.type === "sync" && msg.room && Array.isArray(msg.update)) {
        let room = rooms.get(msg.room);
        if (!room) {
          room = { doc: new Y.Doc(), clients: new Set() };
          rooms.set(msg.room, room);
        }
        room.clients.add(ws);
        ws.room = msg.room;
        const update = Uint8Array.from(msg.update);
        Y.applyUpdate(room.doc, update);
        for (const peer of room.clients) {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) {
            peer.send(
              JSON.stringify({
                type: "sync",
                room: msg.room,
                update: msg.update,
              }),
            );
          }
        }
      }
    });

    ws.on("close", () => {
      if (!ws.room) return;
      const room = rooms.get(ws.room);
      room?.clients.delete(ws);
    });
  });

  const address = wss.address();
  const resolvedPort =
    typeof address === "object" && address ? address.port : port;

  return {
    wss,
    port: resolvedPort,
    url: `ws://${host}:${resolvedPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const isDirectRun =
  process.argv[1]?.includes("server.ts") ||
  process.argv[1]?.includes("server.js");

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 1234);
  const s = await startCollabServer({ port });
  console.log(`[gate0-collab-server] listening on ${s.url}`);
}
