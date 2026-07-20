import {describe, expect, it, vi} from "vitest";
import * as Y from "yjs";
import {
  DATA_CHANNEL_CHUNK_CHARS,
  createChunkReassembler,
} from "./data-channel-framing.js";
import {
  createWebRtcProvider,
  createWebRtcTransport,
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

  it("initiates an encrypted-channel offer to peers that join after us", async () => {
    FakeSocket.instances = [];
    const created: RTCPeerConnection[] = [];
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
