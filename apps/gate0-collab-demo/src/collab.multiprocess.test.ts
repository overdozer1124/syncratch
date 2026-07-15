/**
 * Multi-process WebSocket collab gate0 test.
 * Spawns a **server child process**; two clients run in this Vitest process
 * (evidence of cross-process server, not two client OS processes).
 */
import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import {
  CollaborationDocument,
  applyUpdate,
  encodeState,
} from "@blocksync/collaboration-domain";
import { validateProject, type ProjectDocument } from "@blocksync/project-schema";
import { makeSpriteStack } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "../../gate0-collab-server/src/server.ts");

async function freePort(): Promise<number> {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const addr = s.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  s.close();
  await once(s, "close");
  return port;
}

function spawnTs(script: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(
    process.execPath,
    ["--import", "tsx", script],
    {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    },
  );
}

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.once("open", () => {
          ws.close();
          resolve();
        });
        ws.once("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server not ready");
}

class ProcessClient {
  readonly doc = new CollaborationDocument();
  private ws: WebSocket | null = null;
  private joined = false;

  constructor(private room: string) {}

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
          if (!this.joined) {
            this.joined = true;
            resolve();
          }
        }
      });
      this.ws.on("error", reject);
      setTimeout(() => reject(new Error("join timeout")), 15_000);
    });
  }

  publish(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error("no ws"));
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(String(data)) as { type: string };
        if (msg.type === "accepted" || msg.type === "reject") {
          this.ws!.off("message", onMsg);
          if (msg.type === "reject") reject(new Error("rejected"));
          else resolve();
        }
      };
      this.ws.on("message", onMsg);
      this.ws.send(
        JSON.stringify({
          type: "sync",
          room: this.room,
          update: Array.from(encodeState(this.doc)),
        }),
      );
    });
  }

  close(): void {
    this.ws?.close();
  }
}

function normalizeDoc(doc: ProjectDocument): string {
  return JSON.stringify({
    targets: doc.targets
      .map((t) => ({
        id: t.id,
        name: t.name,
        isStage: t.isStage,
        blocks: t.blocks,
        variables: t.variables ?? {},
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

describe("gate0 multi-process WebSocket collab (child server)", () => {
  it("converges full documents across two in-process clients via child server", async () => {
    const port = await freePort();
    const url = `ws://127.0.0.1:${port}`;
    const server = spawnTs(serverEntry, { PORT: String(port) });
    const stderr: string[] = [];
    server.stderr?.on("data", (d) => stderr.push(String(d)));
    try {
      await waitForServer(url);
      const room = "mp-room";
      const a = new ProcessClient(room);
      const b = new ProcessClient(room);
      await a.connect(url);
      await b.connect(url);

      expect(
        a.doc.applySpriteBlocks({
          transactionId: "a1",
          spriteId: "spriteA",
          blocks: makeSpriteStack("spriteA", 10),
        }).accepted,
      ).toBe(true);
      await a.publish();
      await new Promise((r) => setTimeout(r, 300));

      expect(
        b.doc.applySpriteBlocks({
          transactionId: "b1",
          spriteId: "spriteB",
          blocks: makeSpriteStack("spriteB", 20),
        }).accepted,
      ).toBe(true);
      await b.publish();
      await new Promise((r) => setTimeout(r, 300));

      for (let i = 0; i < 200; i++) {
        const client = i % 2 === 0 ? a : b;
        const sprite = i % 2 === 0 ? "spriteA" : "spriteB";
        expect(
          client.doc.applySpriteBlocks({
            transactionId: `bulk-${i}`,
            spriteId: sprite,
            blocks: makeSpriteStack(sprite, i + 1),
          }).accepted,
        ).toBe(true);
        await client.publish();
      }
      await new Promise((r) => setTimeout(r, 500));

      // Fresh clients receive server authority document on join
      const a2 = new ProcessClient(room);
      const b2 = new ProcessClient(room);
      await a2.connect(url);
      await b2.connect(url);

      const da = a2.doc.materialize();
      const db = b2.doc.materialize();
      expect(validateProject(da).ok).toBe(true);
      expect(validateProject(db).ok).toBe(true);
      expect(normalizeDoc(da)).toEqual(normalizeDoc(db));
      expect(da.targets.some((t) => t.id === "spriteA")).toBe(true);
      expect(da.targets.some((t) => t.id === "spriteB")).toBe(true);

      a.close();
      b.close();
      a2.close();
      b2.close();
    } finally {
      server.kill("SIGTERM");
    }
  }, 120_000);
});
