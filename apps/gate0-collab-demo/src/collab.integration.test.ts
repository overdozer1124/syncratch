import { describe, expect, it } from "vitest";
import { startCollabServer } from "@blocksync/gate0-collab-server/server";
import {
  WsCollabClient,
  makeSpriteStack,
  waitFor,
  validateProject,
} from "./client.js";

describe("gate0 WebSocket collab (in-process server + two clients)", () => {
  it("syncs different sprites over WebSocket and preserves invariants", async () => {
    const server = await startCollabServer({ port: 0, host: "127.0.0.1" });
    const room = "gate0-room";
    const a = new WsCollabClient(room);
    const b = new WsCollabClient(room);
    await a.connect(server.url);
    await b.connect(server.url);

    const r1 = a.doc.applySpriteBlocks({
      transactionId: "a-1",
      spriteId: "spriteA",
      blocks: makeSpriteStack("spriteA", 10),
    });
    expect(r1.accepted).toBe(true);
    a.publish();

    await waitFor(() =>
      b.doc.materialize().targets.some((t) => t.id === "spriteA"),
    );

    const r2 = b.doc.applySpriteBlocks({
      transactionId: "b-1",
      spriteId: "spriteB",
      blocks: makeSpriteStack("spriteB", 20),
    });
    expect(r2.accepted).toBe(true);
    b.publish();

    await waitFor(() =>
      a.doc.materialize().targets.some((t) => t.id === "spriteB"),
    );

    const finalA = a.doc.materialize();
    const finalB = b.doc.materialize();
    expect(validateProject(finalA).ok).toBe(true);
    expect(validateProject(finalB).ok).toBe(true);

    // 1000 ops across sprites (odd -> A, even -> B) over WebSocket
    for (let i = 0; i < 1000; i++) {
      const client = i % 2 === 0 ? a : b;
      const sprite = i % 2 === 0 ? "spriteA" : "spriteB";
      const res = client.doc.applySpriteBlocks({
        transactionId: `bulk-${i}`,
        spriteId: sprite,
        blocks: makeSpriteStack(sprite, i + 1),
      });
      expect(res.accepted).toBe(true);
      client.publish();
    }

    await waitFor(() => {
      const da = a.doc.materialize();
      const db = b.doc.materialize();
      const aMove = Object.values(
        da.targets.find((t) => t.id === "spriteA")?.blocks ?? {},
      ).find((b) => b.opcode === "motion_movesteps");
      const bMove = Object.values(
        db.targets.find((t) => t.id === "spriteA")?.blocks ?? {},
      ).find((b) => b.opcode === "motion_movesteps");
      return Boolean(aMove && bMove && aMove.id === bMove.id);
    }, 30_000);

    expect(validateProject(a.doc.materialize()).ok).toBe(true);
    expect(validateProject(b.doc.materialize()).ok).toBe(true);

    a.close();
    b.close();
    await server.close();
  }, 120_000);
});
