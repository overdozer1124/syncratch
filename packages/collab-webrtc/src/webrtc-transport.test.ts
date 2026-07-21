import {describe, expect, it, vi} from "vitest";
import * as Y from "yjs";
import {
  DATA_CHANNEL_CHUNK_CHARS,
  createChunkReassembler,
} from "./data-channel-framing.js";
import {
  DEFAULT_SIGNALING_PING_INTERVAL_MS,
  createWebRtcProvider,
  createWebRtcTransport,
  shouldInitiateOffer,
  type WebSocketLike,
} from "./webrtc-transport.js";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  readonly OPEN = 1;
  sent: any[] = [];
  private listeners: Record<string, ((ev: any) => void)[]> = {};
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, listener: (ev: any) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.fire("close", {});
  }
  fire(type: string, ev: any): void {
    for (const listener of this.listeners[type] ?? []) listener(ev);
  }
  open(): void {
    this.readyState = 1;
    this.fire("open", {});
  }
  message(obj: unknown): void {
    this.fire("message", {data: JSON.stringify(obj)});
  }
  lastSent(): any {
    return this.sent[this.sent.length - 1];
  }
}

function fakePeerConnection(): RTCPeerConnection & {
  __channel: {
    readyState: string;
    send: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
} {
  const channel = {
    readyState: "connecting",
    addEventListener: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  };
  return {
    __channel: channel,
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({type: "offer", sdp: "fake-offer"})),
    createAnswer: vi.fn(async () => ({type: "answer", sdp: "fake-answer"})),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    addIceCandidate: vi.fn(async () => undefined),
    addEventListener: vi.fn(),
    close: vi.fn(),
    connectionState: "new",
  } as unknown as RTCPeerConnection & {__channel: typeof channel};
}

const TOPIC = "c".repeat(43);
const SECRET = "room-secret-room-secret-room-secret-1";

describe("createWebRtcTransport signaling wiring", () => {
  it("connects only to the configured signaling URL and joins the hashed topic", () => {
    FakeSocket.instances = [];
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: fakePeerConnection,
    });
    transport.connect("peer-a", {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    });
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe("ws://127.0.0.1:9999/signal");
    socket.open();
    expect(socket.lastSent()).toEqual({t: "join", topic: TOPIC, peer: "peer-a"});
  });

  it("ignores stale socket events after reconnect", () => {
    FakeSocket.instances = [];
    const onStatus = vi.fn();
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: fakePeerConnection,
    });
    const handlers = {
      onStatus,
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    };

    transport.connect("peer-a", handlers);
    const staleSocket = FakeSocket.instances[0]!;
    staleSocket.open();
    transport.disconnect();
    transport.connect("peer-a", handlers);
    const currentSocket = FakeSocket.instances[1]!;
    currentSocket.open();
    staleSocket.fire("close", {});
    staleSocket.fire("error", {});

    expect(onStatus).toHaveBeenLastCalledWith("connected");
  });

  it("ignores stale peer close events after reconnect", async () => {
    FakeSocket.instances = [];
    const created: ReturnType<typeof fakePeerConnection>[] = [];
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: () => {
        const pc = fakePeerConnection();
        created.push(pc);
        return pc;
      },
    });
    const handlers = {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    };

    transport.connect("peer-a", handlers);
    FakeSocket.instances[0]!.message({t: "peer", peer: "peer-b"});
    await new Promise(resolve => setTimeout(resolve, 0));
    const staleChannel = created[0]!.__channel;
    const staleClose = staleChannel.addEventListener.mock.calls
      .find(([event]) => event === "close")?.[1] as (() => void);

    transport.disconnect();
    transport.connect("peer-a", handlers);
    FakeSocket.instances[1]!.message({t: "peer", peer: "peer-b"});
    await new Promise(resolve => setTimeout(resolve, 0));
    const currentChannel = created[1]!.__channel;
    currentChannel.readyState = "open";

    staleClose();
    transport.send("peer-b", "current-wire");
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(currentChannel.send).toHaveBeenCalledWith("current-wire");
  });

  it("initiates an encrypted-channel offer to peers that join after us", async () => {
    FakeSocket.instances = [];
    const created: RTCPeerConnection[] = [];
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      pingIntervalMs: 0,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: () => {
        const pc = fakePeerConnection();
        created.push(pc);
        return pc;
      },
    });
    transport.connect("peer-a", {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    });
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.message({t: "joined", topic: TOPIC, peers: []});
    socket.message({t: "peer", topic: TOPIC, peer: "peer-b"});
    await new Promise((r) => setTimeout(r, 0));

    expect(created).toHaveLength(1);
    const offerSignal = socket.sent.find((m) => m.t === "signal" && m.to === "peer-b");
    expect(offerSignal?.data?.description?.type).toBe("offer");
  });

  it("initiates from joined.peers when the local id should offer", async () => {
    FakeSocket.instances = [];
    const created: RTCPeerConnection[] = [];
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      pingIntervalMs: 0,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: () => {
        const pc = fakePeerConnection();
        created.push(pc);
        return pc;
      },
    });
    transport.connect("peer-a", {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    });
    const socket = FakeSocket.instances[0]!;
    socket.open();
    // Existing peer list only — no separate "peer" broadcast (missed/race).
    socket.message({t: "joined", topic: TOPIC, peers: ["peer-z"]});
    await new Promise((r) => setTimeout(r, 0));

    expect(shouldInitiateOffer("peer-a", "peer-z")).toBe(true);
    expect(created).toHaveLength(1);
    expect(socket.sent.some((m) => m.t === "signal" && m.to === "peer-z")).toBe(true);
  });

  it("does not initiate from joined.peers when the remote id should offer", async () => {
    FakeSocket.instances = [];
    const created: RTCPeerConnection[] = [];
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      pingIntervalMs: 0,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: () => {
        const pc = fakePeerConnection();
        created.push(pc);
        return pc;
      },
    });
    transport.connect("peer-z", {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    });
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.message({t: "joined", topic: TOPIC, peers: ["peer-a"]});
    await new Promise((r) => setTimeout(r, 0));

    expect(shouldInitiateOffer("peer-z", "peer-a")).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("sends signaling ping keepalive while connected", () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      pingIntervalMs: 1_000,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: fakePeerConnection,
    });
    transport.connect("peer-a", {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    });
    const socket = FakeSocket.instances[0]!;
    socket.open();
    expect(socket.sent.some((m) => m.t === "join")).toBe(true);
    const before = socket.sent.length;
    vi.advanceTimersByTime(1_000);
    expect(socket.sent.length).toBeGreaterThan(before);
    expect(socket.sent.some((m) => m.t === "ping")).toBe(true);
    expect(DEFAULT_SIGNALING_PING_INTERVAL_MS).toBe(20_000);
    transport.disconnect();
    vi.useRealTimers();
  });

  it("buffers ICE candidates that arrive before remote description", async () => {
    FakeSocket.instances = [];
    let pc: ReturnType<typeof fakePeerConnection> | null = null;
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      pingIntervalMs: 0,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: () => {
        pc = fakePeerConnection();
        return pc;
      },
    });
    transport.connect("peer-z", {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    });
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.message({t: "joined", topic: TOPIC, peers: []});
    // Early candidate before any description — must not be dropped.
    socket.message({
      t: "signal",
      topic: TOPIC,
      from: "peer-a",
      data: {candidate: {candidate: "early", sdpMid: "0"}},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(pc).toBeNull();

    socket.message({
      t: "signal",
      topic: TOPIC,
      from: "peer-a",
      data: {description: {type: "offer", sdp: "fake-offer"}},
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(pc).not.toBeNull();
    expect(pc!.setRemoteDescription).toHaveBeenCalled();
    expect(pc!.addIceCandidate).toHaveBeenCalledWith({
      candidate: "early",
      sdpMid: "0",
    });
  });

  it("chunks large data-channel payloads and reassembles on receive", async () => {
    FakeSocket.instances = [];
    let pc: ReturnType<typeof fakePeerConnection> | null = null;
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: () => {
        pc = fakePeerConnection();
        return pc;
      },
    });
    transport.connect("peer-a", {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    });
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.message({t: "joined", topic: TOPIC, peers: []});
    socket.message({t: "peer", topic: TOPIC, peer: "peer-b"});
    await new Promise((r) => setTimeout(r, 0));

    const channel = pc!.__channel;
    channel.readyState = "open";
    const wire = "z".repeat(DATA_CHANNEL_CHUNK_CHARS * 2 + 10);
    transport.send("peer-b", wire);

    // Allow the async send queue to flush.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(channel.send.mock.calls.length).toBeGreaterThan(1);

    const reassembler = createChunkReassembler();
    let reassembled: string | null = null;
    for (const [frame] of channel.send.mock.calls) {
      reassembled = reassembler.push(frame as string) ?? reassembled;
    }
    expect(reassembled).toBe(wire);
  });
});

describe("no public / non-ws signaling fallback", () => {
  it("rejects a non-ws(s) signaling URL", () => {
    expect(() =>
      createWebRtcTransport({
        signalingUrl: "https://public.example/signal",
        topic: TOPIC,
        WebSocketImpl: (url) => new FakeSocket(url),
        createPeerConnection: fakePeerConnection,
      }),
    ).toThrow(/ws/i);
  });

  it("rejects a topic that is not a hashed value", () => {
    expect(() =>
      createWebRtcTransport({
        signalingUrl: "ws://127.0.0.1:9999/signal",
        topic: "room secret leaked!",
        WebSocketImpl: (url) => new FakeSocket(url),
        createPeerConnection: fakePeerConnection,
      }),
    ).toThrow(/topic/i);
  });

  it("sends only the hashed topic and random peer id when joining (no secret/file id)", () => {
    FakeSocket.instances = [];
    const transport = createWebRtcTransport({
      signalingUrl: "ws://127.0.0.1:9999/signal",
      topic: TOPIC,
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: fakePeerConnection,
    });
    transport.connect("p-random", {
      onStatus: vi.fn(),
      onPeerOpen: vi.fn(),
      onPeerClose: vi.fn(),
      onMessage: vi.fn(),
    });
    const socket = FakeSocket.instances[0]!;
    socket.open();
    expect(socket.sent).toEqual([{t: "join", topic: TOPIC, peer: "p-random"}]);
    const joined = JSON.stringify(socket.sent);
    expect(joined).not.toContain(SECRET);
    expect(joined).not.toContain("driveFileId");
  });
});

describe("createWebRtcProvider guards", () => {
  it("refuses to build without a configured signaling URL (no public fallback)", () => {
    expect(() =>
      createWebRtcProvider({
        doc: new Y.Doc(),
        secret: SECRET,
        topic: TOPIC,
        signalingUrl: "   ",
        WebSocketImpl: (url) => new FakeSocket(url),
        createPeerConnection: fakePeerConnection,
      }),
    ).toThrow(/signaling/i);
  });

  it("builds a provider when signaling is configured", () => {
    const provider = createWebRtcProvider({
      doc: new Y.Doc(),
      secret: SECRET,
      topic: TOPIC,
      signalingUrl: "ws://127.0.0.1:9999/signal",
      participantId: "peer-a",
      WebSocketImpl: (url) => new FakeSocket(url),
      createPeerConnection: fakePeerConnection,
    });
    expect(provider.participantId).toBe("peer-a");
    expect(provider.getStatus()).toBe("disconnected");
  });
});
