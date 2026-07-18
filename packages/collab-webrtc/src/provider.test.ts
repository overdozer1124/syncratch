import {describe, expect, it} from "vitest";
import * as Y from "yjs";
import {createCollabProvider} from "./provider.js";
import {createMemoryMesh} from "./memory-mesh.js";

const SECRET = "shared-room-secret-shared-room-secret";

async function flushAll(...providers: {flush(): Promise<void>}[]): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.all(providers.map((p) => p.flush()));
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("createCollabProvider sync", () => {
  it("converges two docs over an in-memory mesh and reports connected", async () => {
    const mesh = createMemoryMesh();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = createCollabProvider({
      doc: docA,
      secret: SECRET,
      transport: mesh.createTransport(),
      participantId: "peer-a",
    });
    const b = createCollabProvider({
      doc: docB,
      secret: SECRET,
      transport: mesh.createTransport(),
      participantId: "peer-b",
    });

    docA.getMap("m").set("fromA", 1);
    a.connect();
    b.connect();
    await flushAll(a, b);

    docB.getMap("m").set("fromB", 2);
    await flushAll(a, b);

    expect(docB.getMap("m").get("fromA")).toBe(1);
    expect(docA.getMap("m").get("fromB")).toBe(2);
    expect(a.getStatus()).toBe("connected");
  });

  it("does not create a feedback loop: local edits broadcast, applied remote edits do not", async () => {
    const mesh = createMemoryMesh();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = createCollabProvider({doc: docA, secret: SECRET, transport: mesh.createTransport(), participantId: "a"});
    const b = createCollabProvider({doc: docB, secret: SECRET, transport: mesh.createTransport(), participantId: "b"});
    a.connect();
    b.connect();
    await flushAll(a, b);

    let broadcastsFromB = 0;
    b.onOutgoingUpdate(() => (broadcastsFromB += 1));

    docA.getMap("m").set("x", 42);
    await flushAll(a, b);
    // B received and applied A's update but must NOT re-broadcast it.
    expect(docB.getMap("m").get("x")).toBe(42);
    expect(broadcastsFromB).toBe(0);
  });
});

describe("awareness / presence", () => {
  it("exchanges random participant ids and peer membership only", async () => {
    const mesh = createMemoryMesh();
    const a = createCollabProvider({doc: new Y.Doc(), secret: SECRET, transport: mesh.createTransport(), participantId: "peer-a"});
    const b = createCollabProvider({doc: new Y.Doc(), secret: SECRET, transport: mesh.createTransport(), participantId: "peer-b"});
    a.connect();
    b.connect();
    await flushAll(a, b);

    expect(a.getPeers()).toEqual(["peer-b"]);
    expect(b.getPeers()).toEqual(["peer-a"]);
    const remote = a.getAwareness().get("peer-b");
    expect(remote).toMatchObject({participantId: "peer-b"});
    // No identity fields ever appear in awareness.
    expect(Object.keys(remote ?? {})).not.toContain("email");
    expect(Object.keys(remote ?? {})).not.toContain("token");
  });

  it("removes peers and awareness on disconnect", async () => {
    const mesh = createMemoryMesh();
    const a = createCollabProvider({doc: new Y.Doc(), secret: SECRET, transport: mesh.createTransport(), participantId: "peer-a"});
    const b = createCollabProvider({doc: new Y.Doc(), secret: SECRET, transport: mesh.createTransport(), participantId: "peer-b"});
    a.connect();
    b.connect();
    await flushAll(a, b);
    expect(a.getPeers()).toEqual(["peer-b"]);

    b.disconnect();
    await flushAll(a, b);
    expect(a.getPeers()).toEqual([]);
    expect(a.getAwareness().has("peer-b")).toBe(false);
    expect(b.getStatus()).toBe("disconnected");
  });

});

describe("remote-state acceptance hook", () => {
  it("routes remote updates through the injected verifier and can reject them", async () => {
    const mesh = createMemoryMesh();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const rejected: number[] = [];
    const a = createCollabProvider({doc: docA, secret: SECRET, transport: mesh.createTransport(), participantId: "a"});
    const b = createCollabProvider({
      doc: docB,
      secret: SECRET,
      transport: mesh.createTransport(),
      participantId: "b",
      applyRemoteUpdate: (update) => {
        // Reject everything to prove the hook gates acceptance.
        rejected.push(update.byteLength);
        return false;
      },
    });
    a.connect();
    b.connect();
    await flushAll(a, b);

    docA.getMap("m").set("secret", "value");
    await flushAll(a, b);
    expect(docB.getMap("m").has("secret")).toBe(false);
    expect(rejected.length).toBeGreaterThan(0);
  });
});
