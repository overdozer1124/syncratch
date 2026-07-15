import WebSocket from "ws";
import {
  CollaborationDocument,
  applyUpdate,
  encodeState,
} from "@blocksync/collaboration-domain";
import { validateProject } from "@blocksync/project-schema";
import type { ScratchBlock } from "@blocksync/project-schema";

export class WsCollabClient {
  readonly doc = new CollaborationDocument();
  private ws: WebSocket | null = null;
  private room: string;

  constructor(room: string) {
    this.room = room;
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on("open", () => {
        this.ws!.send(JSON.stringify({ type: "join", room: this.room }));
      });
      this.ws.on("message", (data) => {
        const msg = JSON.parse(String(data)) as {
          type: string;
          update?: number[];
        };
        if (msg.type === "sync" && msg.update) {
          applyUpdate(this.doc, Uint8Array.from(msg.update));
          if (!this._joined) {
            this._joined = true;
            resolve();
          }
        }
      });
      this.ws.on("error", reject);
      setTimeout(() => {
        if (!this._joined) reject(new Error("join timeout"));
      }, 10_000);
    });
  }

  private _joined = false;

  publish(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("not connected");
    }
    const update = encodeState(this.doc);
    this.ws.send(
      JSON.stringify({
        type: "sync",
        room: this.room,
        update: Array.from(update),
      }),
    );
  }

  close(): void {
    this.ws?.close();
  }
}

export function makeSpriteStack(
  sprite: string,
  steps: number,
): Record<string, ScratchBlock> {
  const hat = `${sprite}-hat`;
  const move = `${sprite}-move-${steps}`;
  return {
    [hat]: {
      id: hat,
      opcode: "event_whenflagclicked",
      next: move,
      parent: null,
      inputs: {},
      fields: {},
      topLevel: true,
    },
    [move]: {
      id: move,
      opcode: "motion_movesteps",
      next: null,
      parent: hat,
      inputs: { STEPS: [1, [4, String(steps)]] },
      fields: {},
      topLevel: false,
    },
  };
}

export async function waitFor(
  pred: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

export { validateProject };
