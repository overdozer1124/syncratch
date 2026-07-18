/**
 * Browser-only WebRTC transport: signaling over a configured WebSocket URL and
 * peer-to-peer data channels over RTCPeerConnection.
 *
 * There is NO public signaling fallback. A signaling URL must be configured;
 * without it, room creation/join is refused and the app degrades to local
 * editing/export. ICE servers default to none (host candidates only, which is
 * enough for same-machine E2E and many LANs). A caller may configure STUN/TURN,
 * but this project neither ships nor purchases a TURN service, so WebRTC may
 * still fail on restrictive networks.
 */
import * as Y from "yjs";
import {createCollabProvider, type CollabProvider, type CollabProviderOptions} from "./provider.js";
import type {CollabTransport, TransportHandlers} from "./transport.js";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: any) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebRtcTransportOptions {
  signalingUrl: string;
  topic: string;
  iceServers?: RTCIceServer[];
  WebSocketImpl?: WebSocketFactory;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  initiator: boolean;
}

function requireSignalingUrl(signalingUrl: string): string {
  if (typeof signalingUrl !== "string" || signalingUrl.trim().length === 0) {
    throw new Error("A signaling URL must be configured; public signaling fallback is disabled");
  }
  let parsed: URL;
  try {
    parsed = new URL(signalingUrl.trim());
  } catch {
    throw new Error("Signaling URL must be a valid ws/wss URL");
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Signaling URL must use ws or wss (no public https signaling fallback)");
  }
  return signalingUrl.trim();
}

function requireHashedTopic(topic: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(topic)) {
    throw new Error("A valid one-way hashed signaling topic is required");
  }
  return topic;
}

export function createWebRtcTransport(options: WebRtcTransportOptions): CollabTransport {
  const signalingUrl = requireSignalingUrl(options.signalingUrl);
  const topic = requireHashedTopic(options.topic);
  const iceServers = options.iceServers ?? [];
  const makeSocket: WebSocketFactory =
    options.WebSocketImpl ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  const makePc =
    options.createPeerConnection ?? ((config) => new RTCPeerConnection(config));

  let socket: WebSocketLike | null = null;
  let localPeerId = "";
  let handlers: TransportHandlers | null = null;
  const peerConnections = new Map<string, PeerEntry>();

  const signal = (to: string, data: unknown): void => {
    socket?.send(JSON.stringify({t: "signal", topic, to, data}));
  };

  const attachChannel = (peerId: string, entry: PeerEntry, channel: RTCDataChannel): void => {
    entry.channel = channel;
    channel.addEventListener("open", () => handlers?.onPeerOpen(peerId));
    channel.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data === "string") handlers?.onMessage(peerId, ev.data);
    });
    channel.addEventListener("close", () => {
      handlers?.onPeerClose(peerId);
    });
  };

  const createPeer = (peerId: string, initiator: boolean): PeerEntry => {
    const pc = makePc({iceServers});
    const entry: PeerEntry = {pc, channel: null, initiator};
    peerConnections.set(peerId, entry);
    pc.addEventListener("icecandidate", (ev: RTCPeerConnectionIceEvent) => {
      if (ev.candidate) signal(peerId, {candidate: ev.candidate.toJSON()});
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        handlers?.onPeerClose(peerId);
      }
    });
    if (initiator) {
      const channel = pc.createDataChannel("blocksync");
      attachChannel(peerId, entry, channel);
      void (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signal(peerId, {description: offer});
      })();
    } else {
      pc.addEventListener("datachannel", (ev: RTCDataChannelEvent) => {
        attachChannel(peerId, entry, ev.channel);
      });
    }
    return entry;
  };

  const closePeer = (peerId: string): void => {
    const entry = peerConnections.get(peerId);
    if (!entry) return;
    peerConnections.delete(peerId);
    try {
      entry.channel?.close();
      entry.pc.close();
    } catch {
      // ignore teardown errors
    }
    handlers?.onPeerClose(peerId);
  };

  const onSignal = async (from: string, data: any): Promise<void> => {
    let entry = peerConnections.get(from);
    if (data?.description) {
      if (!entry) entry = createPeer(from, false);
      await entry.pc.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        signal(from, {description: answer});
      }
    } else if (data?.candidate && entry) {
      try {
        await entry.pc.addIceCandidate(data.candidate);
      } catch {
        // ignore late/duplicate candidates
      }
    }
  };

  const onSocketMessage = (raw: string): void => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case "joined":
        // Peers already present will initiate to us; we wait for their offers.
        break;
      case "peer":
        if (typeof msg.peer === "string" && !peerConnections.has(msg.peer)) {
          createPeer(msg.peer, true);
        }
        break;
      case "signal":
        if (typeof msg.from === "string") void onSignal(msg.from, msg.data);
        break;
      case "leave":
        if (typeof msg.peer === "string") closePeer(msg.peer);
        break;
      default:
        break;
    }
  };

  return {
    connect(peerId, transportHandlers) {
      localPeerId = peerId;
      handlers = transportHandlers;
      handlers.onStatus("connecting");
      socket = makeSocket(signalingUrl);
      socket.addEventListener("open", () => {
        socket?.send(JSON.stringify({t: "join", topic, peer: localPeerId}));
        handlers?.onStatus("connected");
      });
      socket.addEventListener("message", (ev: MessageEvent) => {
        if (typeof ev.data === "string") onSocketMessage(ev.data);
      });
      socket.addEventListener("close", () => handlers?.onStatus("disconnected"));
      socket.addEventListener("error", () => handlers?.onStatus("disconnected"));
    },
    send(peerId, wire) {
      const channel = peerConnections.get(peerId)?.channel;
      if (channel && channel.readyState === "open") channel.send(wire);
    },
    broadcast(wire) {
      for (const entry of peerConnections.values()) {
        if (entry.channel && entry.channel.readyState === "open") entry.channel.send(wire);
      }
    },
    disconnect() {
      for (const peerId of [...peerConnections.keys()]) closePeer(peerId);
      try {
        socket?.close();
      } catch {
        // ignore
      }
      socket = null;
      handlers?.onStatus("disconnected");
    },
  };
}

export interface WebRtcProviderOptions
  extends Omit<CollabProviderOptions, "transport">,
    Omit<WebRtcTransportOptions, "topic"> {
  topic: string;
}

/** Convenience: build a Yjs collaboration provider over the WebRTC transport. */
export function createWebRtcProvider(options: WebRtcProviderOptions): CollabProvider {
  requireSignalingUrl(options.signalingUrl);
  const transport = createWebRtcTransport({
    signalingUrl: options.signalingUrl,
    topic: options.topic,
    iceServers: options.iceServers,
    WebSocketImpl: options.WebSocketImpl,
    createPeerConnection: options.createPeerConnection,
  });
  return createCollabProvider({
    doc: options.doc,
    secret: options.secret,
    transport,
    participantId: options.participantId,
    randomId: options.randomId,
    applyRemoteUpdate: options.applyRemoteUpdate,
    isLocalOrigin: options.isLocalOrigin,
    presence: options.presence,
  });
}

export {Y};
