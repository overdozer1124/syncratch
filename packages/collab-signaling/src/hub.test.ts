import {beforeEach, describe, expect, it, vi} from "vitest";
import {DEFAULT_SIGNALING_LIMITS, SignalingHub, type SignalingConnection} from "./hub.js";

const TOPIC = "a".repeat(43); // base64url SHA-256 length

class FakeConnection implements SignalingConnection {
  readonly id: string;
  readonly sent: unknown[] = [];
  closed: {code?: number; reason?: string} | null = null;
  constructor(id: string) {
    this.id = id;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    this.closed = {code, reason};
  }
  last(): Record<string, unknown> {
    return this.sent[this.sent.length - 1] as Record<string, unknown>;
  }
}

let hub: SignalingHub;
let now = 1000;

beforeEach(() => {
  now = 1000;
  hub = new SignalingHub({now: () => now});
});

function join(conn: FakeConnection, peer: string, topic = TOPIC): void {
  hub.handleConnection(conn);
  hub.handleMessage(conn, JSON.stringify({t: "join", topic, peer}));
}

describe("join and membership", () => {
  it("acknowledges a join with the current peer list and broadcasts new peers", () => {
    const a = new FakeConnection("a");
    join(a, "peer-a");
    expect(a.last()).toMatchObject({t: "joined", topic: TOPIC, peers: []});

    const b = new FakeConnection("b");
    join(b, "peer-b");
    expect(b.last()).toMatchObject({t: "joined", peers: ["peer-a"]});
    // a is told that peer-b joined.
    expect(a.last()).toMatchObject({t: "peer", peer: "peer-b"});
  });

  it("replaces a stale membership when the same peer id rejoins", () => {
    const stale = new FakeConnection("stale");
    const fresh = new FakeConnection("fresh");
    const other = new FakeConnection("other");
    join(stale, "peer-a");
    join(other, "peer-b");
    join(fresh, "peer-a");

    expect(stale.closed).toEqual({code: 4000, reason: "replaced"});
    expect(fresh.last()).toMatchObject({t: "joined", peers: ["peer-b"]});
    expect(other.sent.some(item => (item as {t: string}).t === "leave")).toBe(true);
    expect(other.last()).toMatchObject({t: "peer", peer: "peer-a"});
    expect(hub.stats().peers).toBe(2);
  });

  it("removes a peer on close and notifies the remaining peers", () => {
    const a = new FakeConnection("a");
    const b = new FakeConnection("b");
    join(a, "peer-a");
    join(b, "peer-b");
    hub.handleClose(b);
    expect(a.last()).toMatchObject({t: "leave", peer: "peer-b"});
    // Ephemeral: once empty the topic is dropped.
    hub.handleClose(a);
    expect(hub.stats().topics).toBe(0);
  });
});

describe("signal relay", () => {
  it("relays a signal only to the addressed peer with an injected from", () => {
    const a = new FakeConnection("a");
    const b = new FakeConnection("b");
    const c = new FakeConnection("c");
    join(a, "peer-a");
    join(b, "peer-b");
    join(c, "peer-c");

    const before = b.sent.length;
    const cBefore = c.sent.length;
    hub.handleMessage(
      a,
      JSON.stringify({t: "signal", topic: TOPIC, to: "peer-b", data: {sdp: "x"}}),
    );
    expect(b.sent.length).toBe(before + 1);
    expect(b.last()).toEqual({t: "signal", topic: TOPIC, from: "peer-a", data: {sdp: "x"}});
    // c never receives another peer's signal.
    expect(c.sent.length).toBe(cBefore);
  });

  it("rejects a signal before joining", () => {
    const a = new FakeConnection("a");
    hub.handleConnection(a);
    hub.handleMessage(a, JSON.stringify({t: "signal", topic: TOPIC, to: "x", data: {}}));
    expect(a.last()).toMatchObject({t: "error"});
  });

  it("does not relay to an unknown peer", () => {
    const a = new FakeConnection("a");
    join(a, "peer-a");
    hub.handleMessage(
      a,
      JSON.stringify({t: "signal", topic: TOPIC, to: "ghost", data: {}}),
    );
    expect(a.last()).toMatchObject({t: "error"});
  });
});

describe("validation and limits", () => {
  it("closes a connection that exceeds the per-window message rate", () => {
    const limited = new SignalingHub({
      now: () => now,
      maxMessagesPerWindow: 2,
      rateWindowMs: 1000,
    });
    const a = new FakeConnection("a");
    limited.handleConnection(a);
    limited.handleMessage(a, JSON.stringify({t: "ping"}));
    limited.handleMessage(a, JSON.stringify({t: "ping"}));
    limited.handleMessage(a, JSON.stringify({t: "ping"}));

    expect(a.closed).toEqual({code: 1008, reason: "message rate exceeded"});
  });

  it("rejects oversized messages without processing", () => {
    const a = new FakeConnection("a");
    hub.handleConnection(a);
    const huge = "x".repeat(DEFAULT_SIGNALING_LIMITS.maxMessageBytes + 1);
    hub.handleMessage(a, JSON.stringify({t: "join", topic: TOPIC, peer: huge}));
    expect(a.closed).not.toBeNull();
  });

  it("rejects a malformed message shape", () => {
    const a = new FakeConnection("a");
    hub.handleConnection(a);
    hub.handleMessage(a, "not json");
    expect(a.last()).toMatchObject({t: "error"});
    hub.handleMessage(a, JSON.stringify({t: "bogus"}));
    expect(a.last()).toMatchObject({t: "error"});
  });

  it("rejects an over-long or malformed topic", () => {
    const a = new FakeConnection("a");
    hub.handleConnection(a);
    const longTopic = "a".repeat(DEFAULT_SIGNALING_LIMITS.maxTopicLength + 1);
    hub.handleMessage(a, JSON.stringify({t: "join", topic: longTopic, peer: "p"}));
    expect(a.last()).toMatchObject({t: "error"});
    const b = new FakeConnection("b");
    hub.handleConnection(b);
    hub.handleMessage(b, JSON.stringify({t: "join", topic: "bad topic!", peer: "p"}));
    expect(b.last()).toMatchObject({t: "error"});
  });

  it("enforces the per-topic peer limit", () => {
    const limitedHub = new SignalingHub({now: () => now, maxPeersPerTopic: 2});
    const a = new FakeConnection("a");
    const b = new FakeConnection("b");
    const c = new FakeConnection("c");
    limitedHub.handleConnection(a);
    limitedHub.handleMessage(a, JSON.stringify({t: "join", topic: TOPIC, peer: "a"}));
    limitedHub.handleConnection(b);
    limitedHub.handleMessage(b, JSON.stringify({t: "join", topic: TOPIC, peer: "b"}));
    limitedHub.handleConnection(c);
    limitedHub.handleMessage(c, JSON.stringify({t: "join", topic: TOPIC, peer: "c"}));
    expect(c.last()).toMatchObject({t: "error"});
    expect(limitedHub.stats().peers).toBe(2);
  });
});

describe("idle expiry", () => {
  it("closes never-joined connections idle beyond the short limit", () => {
    const a = new FakeConnection("a");
    hub.handleConnection(a);
    now += DEFAULT_SIGNALING_LIMITS.idleMs + 1;
    hub.sweepIdle();
    expect(a.closed).not.toBeNull();
  });

  it("keeps joined hosts waiting beyond the short idle window", () => {
    const a = new FakeConnection("a");
    join(a, "peer-a");
    now += DEFAULT_SIGNALING_LIMITS.idleMs + 1;
    hub.sweepIdle();
    expect(a.closed).toBeNull();
  });

  it("closes joined connections idle beyond the joined limit", () => {
    const a = new FakeConnection("a");
    join(a, "peer-a");
    now += DEFAULT_SIGNALING_LIMITS.joinedIdleMs + 1;
    hub.sweepIdle();
    expect(a.closed).not.toBeNull();
  });

  it("keeps recently active joined connections", () => {
    const a = new FakeConnection("a");
    join(a, "peer-a");
    now += 10;
    hub.handleMessage(a, JSON.stringify({t: "ping"}));
    expect(a.last()).toMatchObject({t: "pong"});
    now += DEFAULT_SIGNALING_LIMITS.joinedIdleMs - 5;
    hub.sweepIdle();
    expect(a.closed).toBeNull();
  });
});

describe("statelessness", () => {
  it("never retains relayed signal payloads after delivery", () => {
    const a = new FakeConnection("a");
    const b = new FakeConnection("b");
    join(a, "peer-a");
    join(b, "peer-b");
    hub.handleMessage(
      a,
      JSON.stringify({t: "signal", topic: TOPIC, to: "peer-b", data: {sdp: "secret"}}),
    );
    // No project/update store is exposed; only ephemeral membership counts remain.
    const stats = hub.stats();
    expect(Object.keys(stats).sort()).toEqual(["connections", "peers", "topics"]);
  });
});
