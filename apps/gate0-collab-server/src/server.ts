/**
 * Minimal Yjs WebSocket relay that validates candidate project documents
 * with project-schema BEFORE applying updates to the room authority doc.
 *
 * Protocol:
 *  { type: "join", room }
 *  { type: "sync", room, update: number[] }  // client proposes update
 *  { type: "sync", room, update }             // server broadcasts accepted
 *  { type: "reject", room, reason, issues? }  // server rejected
 */
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import {
  validateProject,
  type ProjectDocument,
  type ScratchBlock,
  type ScratchTarget,
} from "@blocksync/project-schema";

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

function parseJsonField<T>(raw: unknown, label: string): T {
  if (typeof raw !== "string") {
    throw new Error(`${label} must be a JSON string`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(
      `${label} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function asYMap(value: unknown, label: string): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) {
    throw new Error(`${label} must be a Y.Map`);
  }
  return value as Y.Map<unknown>;
}

/** @internal exported for unit tests */
export function materializeFromYDoc(ydoc: Y.Doc): ProjectDocument {
  const sprites = ydoc.getMap("sprites");
  const stageMeta = ydoc.getMap("stage");
  const targets: ScratchTarget[] = [];
  const stageRaw = stageMeta.get("target");
  if (typeof stageRaw === "string") {
    targets.push(parseJsonField<ScratchTarget>(stageRaw, "stage.target"));
  } else if (stageRaw === undefined) {
    targets.push({
      id: "stage",
      name: "Stage",
      isStage: true,
      blocks: {},
      variables: {},
      lists: {},
      broadcasts: {},
    });
  } else {
    throw new Error("stage.target must be a JSON string when present");
  }
  sprites.forEach((spriteVal, spriteId) => {
    const spriteMap = asYMap(spriteVal, `sprites.${spriteId}`);
    const blocksJson = spriteMap.get("blocks");
    const varsJson = spriteMap.get("variables");
    const name = String(spriteMap.get("name") ?? spriteId);
    targets.push({
      id: spriteId,
      name,
      isStage: false,
      blocks:
        blocksJson === undefined
          ? {}
          : parseJsonField<Record<string, ScratchBlock>>(
              blocksJson,
              `sprites.${spriteId}.blocks`,
            ),
      variables:
        varsJson === undefined
          ? {}
          : parseJsonField<ScratchTarget["variables"]>(
              varsJson,
              `sprites.${spriteId}.variables`,
            ),
      lists: {},
      broadcasts: {},
    });
  });
  return { schemaVersion: 1, targets, extensions: [] };
}

function ensureStage(ydoc: Y.Doc): void {
  const stageMeta = ydoc.getMap("stage");
  if (!stageMeta.has("initialized")) {
    ydoc.transact(() => {
      stageMeta.set("initialized", true);
      stageMeta.set(
        "target",
        JSON.stringify({
          id: "stage",
          name: "Stage",
          isStage: true,
          blocks: {},
          variables: {},
          lists: {},
          broadcasts: {},
        } satisfies ScratchTarget),
      );
    });
  }
}

/**
 * Apply update on a clone, validate, then apply to authority only if ok.
 * Never throws to callers — materialization/parse failures become rejected.
 */
export function tryApplyValidatedUpdate(
  authority: Y.Doc,
  update: Uint8Array,
): { accepted: boolean; reason?: string; issues?: unknown[] } {
  const trial = new Y.Doc();
  try {
    Y.applyUpdate(trial, Y.encodeStateAsUpdate(authority));
    Y.applyUpdate(trial, update);
    ensureStage(trial);
    const candidate = materializeFromYDoc(trial);
    const validation = validateProject(candidate);
    if (!validation.ok) {
      return {
        accepted: false,
        reason: "schema_validation_failed",
        issues: validation.issues,
      };
    }
    Y.applyUpdate(authority, update);
    return { accepted: true };
  } catch (e) {
    return {
      accepted: false,
      reason: "materialize_failed",
      issues: [
        {
          code: "MATERIALIZE_ERROR",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  } finally {
    trial.destroy();
  }
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
          const doc = new Y.Doc();
          ensureStage(doc);
          room = { doc, clients: new Set() };
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
          const doc = new Y.Doc();
          ensureStage(doc);
          room = { doc, clients: new Set() };
          rooms.set(msg.room, room);
        }
        room.clients.add(ws);
        ws.room = msg.room;
        const update = Uint8Array.from(msg.update);
        let result: ReturnType<typeof tryApplyValidatedUpdate>;
        try {
          result = tryApplyValidatedUpdate(room.doc, update);
        } catch (e) {
          result = {
            accepted: false,
            reason: "unexpected_error",
            issues: [
              {
                code: "UNEXPECTED",
                message: e instanceof Error ? e.message : String(e),
              },
            ],
          };
        }
        if (!result.accepted) {
          ws.send(
            JSON.stringify({
              type: "reject",
              room: msg.room,
              reason: result.reason,
              issues: result.issues,
            }),
          );
          return;
        }
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
        ws.send(
          JSON.stringify({
            type: "accepted",
            room: msg.room,
          }),
        );
      }
    });

    ws.on("close", () => {
      if (!ws.room) return;
      rooms.get(ws.room)?.clients.delete(ws);
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
  const listenPort = Number(process.env.PORT ?? 1234);
  const s = await startCollabServer({ port: listenPort });
  console.log(`[gate0-collab-server] listening on ${s.url}`);
}
