import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  tryApplyValidatedUpdate,
  startCollabServer,
} from "./server.js";
import WebSocket from "ws";

function authorityFingerprint(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

describe("tryApplyValidatedUpdate (schema gate)", () => {
  it("rejects sprite values that are not Y.Map without throwing", () => {
    const authority = new Y.Doc();
    authority.getMap("stage").set("initialized", true);
    authority.getMap("stage").set(
      "target",
      JSON.stringify({
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
      }),
    );
    const before = authorityFingerprint(authority);

    const poison = new Y.Doc();
    Y.applyUpdate(poison, Y.encodeStateAsUpdate(authority));
    poison.transact(() => {
      // String instead of Y.Map — materialize must fail safely
      poison.getMap("sprites").set("spriteA", "not-a-map" as never);
    });
    const update = Y.encodeStateAsUpdate(poison, Y.encodeStateVector(authority));

    let threw = false;
    let result;
    try {
      result = tryApplyValidatedUpdate(authority, update);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result!.accepted).toBe(false);
    expect(result!.reason).toBe("materialize_failed");
    expect(authorityFingerprint(authority)).toBe(before);
    authority.destroy();
  });

  it("rejects invalid blocks JSON and leaves authority unchanged", () => {
    const authority = new Y.Doc();
    authority.getMap("stage").set("initialized", true);
    authority.getMap("stage").set(
      "target",
      JSON.stringify({
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
      }),
    );
    const before = authorityFingerprint(authority);

    const poison = new Y.Doc();
    Y.applyUpdate(poison, Y.encodeStateAsUpdate(authority));
    poison.transact(() => {
      const m = new Y.Map<unknown>();
      m.set("name", "spriteA");
      m.set("blocks", "{not-json");
      m.set("variables", JSON.stringify({}));
      poison.getMap("sprites").set("spriteA", m);
    });
    const update = Y.encodeStateAsUpdate(poison, Y.encodeStateVector(authority));
    const result = tryApplyValidatedUpdate(authority, update);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("materialize_failed");
    expect(authorityFingerprint(authority)).toBe(before);
    authority.destroy();
  });

  it("rejects invalid variables JSON", () => {
    const authority = new Y.Doc();
    authority.getMap("stage").set("initialized", true);
    authority.getMap("stage").set(
      "target",
      JSON.stringify({
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
      }),
    );
    const poison = new Y.Doc();
    Y.applyUpdate(poison, Y.encodeStateAsUpdate(authority));
    poison.transact(() => {
      const m = new Y.Map<unknown>();
      m.set("name", "spriteA");
      m.set("blocks", JSON.stringify({}));
      m.set("variables", "null{");
      poison.getMap("sprites").set("spriteA", m);
    });
    const update = Y.encodeStateAsUpdate(poison, Y.encodeStateVector(authority));
    const result = tryApplyValidatedUpdate(authority, update);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("materialize_failed");
    authority.destroy();
  });

  it("rejects invalid stage.target JSON", () => {
    const authority = new Y.Doc();
    const before = authorityFingerprint(authority);
    const poison = new Y.Doc();
    poison.transact(() => {
      poison.getMap("stage").set("initialized", true);
      poison.getMap("stage").set("target", "{bad");
    });
    const update = Y.encodeStateAsUpdate(poison);
    const result = tryApplyValidatedUpdate(authority, update);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("materialize_failed");
    expect(authorityFingerprint(authority)).toBe(before);
    authority.destroy();
  });

  it("rejects schema-invalid updates without mutating authority", () => {
    const authority = new Y.Doc();
    authority.getMap("stage").set("initialized", true);
    authority.getMap("stage").set(
      "target",
      JSON.stringify({
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
      }),
    );
    const before = authorityFingerprint(authority);

    const bad = new Y.Doc();
    Y.applyUpdate(bad, Y.encodeStateAsUpdate(authority));
    bad.transact(() => {
      const m = new Y.Map<unknown>();
      m.set("name", "spriteA");
      // Parent/next mismatch → schema failure
      m.set(
        "blocks",
        JSON.stringify({
          a: {
            id: "a",
            opcode: "event_whenflagclicked",
            next: "missing",
            parent: null,
            inputs: {},
            fields: {},
            topLevel: true,
          },
        }),
      );
      m.set("variables", JSON.stringify({}));
      bad.getMap("sprites").set("spriteA", m);
    });
    const update = Y.encodeStateAsUpdate(bad, Y.encodeStateVector(authority));
    const result = tryApplyValidatedUpdate(authority, update);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("schema_validation_failed");
    expect(authorityFingerprint(authority)).toBe(before);
    authority.destroy();
  });
});

describe("WebSocket reject path keeps server alive", () => {
  it("sends reject for poison update then still accepts a later join", async () => {
    const server = await startCollabServer({ port: 0, host: "127.0.0.1" });
    const room = "reject-room";
    try {
      const poison = new Y.Doc();
      poison.transact(() => {
        poison.getMap("sprites").set("x", "not-map" as never);
      });
      const update = Array.from(Y.encodeStateAsUpdate(poison));

      const rejected = await new Promise<{ type: string; reason?: string }>(
        (resolve, reject) => {
          const ws = new WebSocket(server.url);
          ws.on("open", () => {
            ws.send(JSON.stringify({ type: "join", room }));
          });
          ws.on("message", (data) => {
            const msg = JSON.parse(String(data)) as {
              type: string;
              reason?: string;
            };
            if (msg.type === "sync") {
              ws.send(JSON.stringify({ type: "sync", room, update }));
            } else if (msg.type === "reject") {
              ws.close();
              resolve(msg);
            }
          });
          ws.on("error", reject);
          setTimeout(() => reject(new Error("timeout")), 10_000);
        },
      );
      expect(rejected.type).toBe("reject");

      // Server still serves another join
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(server.url);
        ws.on("open", () => ws.send(JSON.stringify({ type: "join", room })));
        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as { type: string };
          if (msg.type === "sync") {
            ws.close();
            resolve();
          }
        });
        ws.on("error", reject);
        setTimeout(() => reject(new Error("second join timeout")), 10_000);
      });
    } finally {
      await server.close();
    }
  });
});
