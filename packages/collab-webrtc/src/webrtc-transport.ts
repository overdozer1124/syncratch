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
import {
  createChunkReassembler,
  packDataChannelWire,
  type ChunkReassembler,
} from "./data-channel-framing.js";
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
  /** Optional diagnostic sink for connection/ICE transitions (debugging/E2E). */
  onDiagnostic?: (message: string) => void;
  /** Keepalive interval for signaling ping; default 20s (hub idle is 60s). */
  pingIntervalMs?: number;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  initiator: boolean;
}

/**
 * Lexicographically smaller peer id keeps its offer during glare.
 * Joiners always offer to peers listed in `joined`; existing peers wait.
 */
export function shouldInitiateOffer(localId: string, remoteId: string): boolean {
  return localId < remoteId;
}

export const DEFAULT_SIGNALING_PING_INTERVAL_MS = 20_000;

/** Public STUN only (not TURN). Helps many NATs; school networks may still block. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {urls: "stun:stun.l.google.com:19302"},
  {urls: "stun:stun1.l.google.com:19302"},
];

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
  const iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
  const pingIntervalMs =
    options.pingIntervalMs ?? DEFAULT_SIGNALING_PING_INTERVAL_MS;
  const makeSocket: WebSocketFactory =
    options.WebSocketImpl ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  const makePc =
    options.createPeerConnection ?? ((config) => new RTCPeerConnection(config));

  let socket: WebSocketLike | null = null;
  let localPeerId = "";
  let handlers: TransportHandlers | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  const peerConnections = new Map<string, PeerEntry>();
  const reassemblers = new Map<string, ChunkReassembler>();
  const sendTail = new Map<string, Promise<void>>();
  const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
  const signalingRoster = new Set<string>();
  const offerRetries = new Map<string, number>();
  const offerRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const MAX_OFFER_RETRIES = 2;
  const OFFER_RETRY_MS = 8_000;
  /** High-water mark before we wait for bufferedamountlow (bytes). */
  const BUFFER_HIGH = 256 * 1024;
  const BUFFER_LOW = 64 * 1024;

  const clearPingTimer = (): void => {
    if (!pingTimer) return;
    clearInterval(pingTimer);
    pingTimer = null;
  };

  const startPingTimer = (connectionSocket: WebSocketLike): void => {
    clearPingTimer();
    if (pingIntervalMs <= 0) return;
    pingTimer = setInterval(() => {
      if (socket !== connectionSocket) return;
      try {
        connectionSocket.send(JSON.stringify({t: "ping"}));
      } catch {
        // Ignore send failures; socket close handling will reconnect.
      }
    }, pingIntervalMs);
  };

  const signal = (to: string, data: unknown): void => {
    socket?.send(JSON.stringify({t: "signal", topic, to, data}));
  };

  const reassemblerFor = (peerId: string): ChunkReassembler => {
    let reassembler = reassemblers.get(peerId);
    if (!reassembler) {
      reassembler = createChunkReassembler();
      reassemblers.set(peerId, reassembler);
    }
    return reassembler;
  };

  const waitForBuffer = (channel: RTCDataChannel): Promise<void> => {
    const buffered = channel.bufferedAmount ?? 0;
    if (channel.readyState !== "open" || buffered <= BUFFER_HIGH) {
      return Promise.resolve();
    }
    channel.bufferedAmountLowThreshold = BUFFER_LOW;
    return new Promise(resolve => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        channel.removeEventListener("bufferedamountlow", finish);
        channel.removeEventListener("close", finish);
        resolve();
      };
      const timeout = setTimeout(finish, 5_000);
      channel.addEventListener("bufferedamountlow", finish);
      channel.addEventListener("close", finish);
      if ((channel.bufferedAmount ?? 0) <= BUFFER_HIGH) finish();
    });
  };

  const sendOnChannel = (
    peerId: string,
    channel: RTCDataChannel,
    wire: string,
  ): void => {
    let frames: string[];
    try {
      frames = packDataChannelWire(wire);
    } catch (error) {
      if (options.onDiagnostic) {
        options.onDiagnostic(`pack-error=${String(error)}`);
      }
      return;
    }

    const run = async (): Promise<void> => {
      for (const frame of frames) {
        if (channel.readyState !== "open") return;
        await waitForBuffer(channel);
        if (channel.readyState !== "open") return;
        try {
          channel.send(frame);
        } catch (error) {
          if (options.onDiagnostic) {
            options.onDiagnostic(`send-error=${String(error)}`);
          }
          return;
        }
      }
    };

    const prev = sendTail.get(peerId) ?? Promise.resolve();
    const next = prev.then(run, run);
    sendTail.set(peerId, next);
    void next.finally(() => {
      if (sendTail.get(peerId) === next) sendTail.delete(peerId);
    });
  };

  const emitSignalingRoster = (): void => {
    handlers?.onSignalingRoster?.([...signalingRoster].sort());
  };

  const clearOfferRetry = (peerId: string): void => {
    const timer = offerRetryTimers.get(peerId);
    if (timer) clearTimeout(timer);
    offerRetryTimers.delete(peerId);
  };

  const scheduleOfferRetry = (peerId: string): void => {
    clearOfferRetry(peerId);
    const attempts = offerRetries.get(peerId) ?? 0;
    if (attempts >= MAX_OFFER_RETRIES) return;
    offerRetryTimers.set(
      peerId,
      setTimeout(() => {
        offerRetryTimers.delete(peerId);
        const entry = peerConnections.get(peerId);
        if (!entry?.initiator) return;
        if (entry.channel?.readyState === "open") return;
        offerRetries.set(peerId, attempts + 1);
        if (options.onDiagnostic) {
          options.onDiagnostic(`offer-retry(${peerId})=${attempts + 1}`);
        }
        closePeer(peerId, entry);
        createPeer(peerId, true);
      }, OFFER_RETRY_MS),
    );
  };

  const closePeer = (peerId: string, expected?: PeerEntry): void => {
    const entry = peerConnections.get(peerId);
    if (!entry) return;
    if (expected && entry !== expected) return;
    clearOfferRetry(peerId);
    peerConnections.delete(peerId);
    reassemblers.delete(peerId);
    sendTail.delete(peerId);
    pendingIceCandidates.delete(peerId);
    try {
      entry.channel?.close();
      entry.pc.close();
    } catch {
      // ignore teardown errors
    }
    handlers?.onPeerClose(peerId);
  };

  const attachChannel = (peerId: string, entry: PeerEntry, channel: RTCDataChannel): void => {
    entry.channel = channel;
    channel.addEventListener("open", () => {
      if (peerConnections.get(peerId) !== entry) return;
      clearOfferRetry(peerId);
      offerRetries.delete(peerId);
      handlers?.onPeerOpen(peerId);
    });
    channel.addEventListener("message", (ev: MessageEvent) => {
      if (peerConnections.get(peerId) !== entry) return;
      if (typeof ev.data !== "string") return;
      const wire = reassemblerFor(peerId).push(ev.data);
      if (wire !== null) handlers?.onMessage(peerId, wire);
    });
    channel.addEventListener("error", () => {
      if (options.onDiagnostic) options.onDiagnostic(`channel-error(${peerId})`);
    });
    channel.addEventListener("close", () => {
      closePeer(peerId, entry);
    });
  };

  const createPeer = (peerId: string, initiator: boolean): PeerEntry => {
    const pc = makePc({iceServers});
    const entry: PeerEntry = {pc, channel: null, initiator};
    peerConnections.set(peerId, entry);
    pc.addEventListener("icecandidate", (ev: RTCPeerConnectionIceEvent) => {
      if (peerConnections.get(peerId) !== entry) return;
      if (options.onDiagnostic) options.onDiagnostic(`cand(${peerId})=${ev.candidate ? "1" : "end"}`);
      if (ev.candidate) signal(peerId, {candidate: ev.candidate.toJSON()});
    });
    pc.addEventListener("connectionstatechange", () => {
      if (peerConnections.get(peerId) !== entry) return;
      if (options.onDiagnostic) options.onDiagnostic(`pc(${peerId})=${pc.connectionState}`);
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        closePeer(peerId, entry);
      }
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      if (options.onDiagnostic) {
        options.onDiagnostic(`ice(${peerId})=${(pc as RTCPeerConnection).iceConnectionState}`);
      }
    });
    if (initiator) {
      const channel = pc.createDataChannel("blocksync");
      attachChannel(peerId, entry, channel);
      void (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signal(peerId, {description: offer});
        scheduleOfferRetry(peerId);
      })().catch((error) => {
        if (options.onDiagnostic) options.onDiagnostic(`offer-error(${peerId})=${String(error)}`);
      });
    } else {
      pc.addEventListener("datachannel", (ev: RTCDataChannelEvent) => {
        attachChannel(peerId, entry, ev.channel);
      });
    }
    return entry;
  };

  const flushPendingIce = async (
    peerId: string,
    entry: PeerEntry,
  ): Promise<void> => {
    const pending = pendingIceCandidates.get(peerId);
    if (!pending || pending.length === 0) return;
    pendingIceCandidates.delete(peerId);
    for (const candidate of pending) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        if (options.onDiagnostic) {
          options.onDiagnostic(`ice-flush-error(${peerId})=${String(error)}`);
        }
      }
    }
  };

  const onSignal = async (from: string, data: any): Promise<void> => {
    try {
      let entry = peerConnections.get(from);
      if (data?.description?.type === "offer") {
        // Glare: both sides offered. Keep the lexicographically smaller id's offer.
        if (entry?.initiator) {
          if (shouldInitiateOffer(localPeerId, from)) {
            if (options.onDiagnostic) {
              options.onDiagnostic(`glare-ignore(${from})`);
            }
            return;
          }
          if (options.onDiagnostic) {
            options.onDiagnostic(`glare-yield(${from})`);
          }
          closePeer(from, entry);
          entry = undefined;
        }
        if (!entry) entry = createPeer(from, false);
        await entry.pc.setRemoteDescription(data.description);
        await flushPendingIce(from, entry);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        signal(from, {description: answer});
        return;
      }
      if (data?.description) {
        if (!entry) entry = createPeer(from, false);
        await entry.pc.setRemoteDescription(data.description);
        await flushPendingIce(from, entry);
        return;
      }
      if (data?.candidate) {
        if (entry?.pc.remoteDescription) {
          await entry.pc.addIceCandidate(data.candidate);
        } else {
          const pending = pendingIceCandidates.get(from) ?? [];
          pending.push(data.candidate as RTCIceCandidateInit);
          pendingIceCandidates.set(from, pending);
        }
      }
    } catch (error) {
      if (options.onDiagnostic) options.onDiagnostic(`signal-error(${from})=${String(error)}`);
    }
  };

  const onSocketMessage = (raw: string): void => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (options.onDiagnostic) options.onDiagnostic(`recv ${msg.t} ${msg.peer ?? msg.from ?? ""}`);
    switch (msg.t) {
      case "joined": {
        // Joiner always offers to peers already in the room.
        const peers = Array.isArray(msg.peers) ? msg.peers : [];
        for (const peer of peers) {
          if (typeof peer !== "string" || peer.length === 0) continue;
          signalingRoster.add(peer);
          if (!peerConnections.has(peer)) createPeer(peer, true);
        }
        emitSignalingRoster();
        break;
      }
      case "peer":
        // Existing member: wait for the joiner's offer (they initiate via joined).
        if (typeof msg.peer === "string" && msg.peer.length > 0) {
          signalingRoster.add(msg.peer);
          emitSignalingRoster();
        }
        break;
      case "signal":
        if (typeof msg.from === "string") {
          signalingRoster.add(msg.from);
          emitSignalingRoster();
          void onSignal(msg.from, msg.data);
        }
        break;
      case "leave":
        if (typeof msg.peer === "string") {
          signalingRoster.delete(msg.peer);
          emitSignalingRoster();
          closePeer(msg.peer);
        }
        break;
      case "pong":
        break;
      default:
        break;
    }
  };

  return {
    connect(peerId, transportHandlers) {
      localPeerId = peerId;
      handlers = transportHandlers;
      clearPingTimer();
      handlers.onStatus("connecting");
      const connectionSocket = makeSocket(signalingUrl);
      const connectionHandlers = transportHandlers;
      socket = connectionSocket;
      connectionSocket.addEventListener("open", () => {
        if (socket !== connectionSocket) return;
        connectionSocket.send(JSON.stringify({t: "join", topic, peer: localPeerId}));
        startPingTimer(connectionSocket);
        connectionHandlers.onStatus("connected");
      });
      connectionSocket.addEventListener("message", (ev: MessageEvent) => {
        if (socket !== connectionSocket) return;
        if (typeof ev.data === "string") onSocketMessage(ev.data);
      });
      const disconnected = (): void => {
        if (socket !== connectionSocket) return;
        clearPingTimer();
        connectionHandlers.onStatus("disconnected");
      };
      connectionSocket.addEventListener("close", disconnected);
      connectionSocket.addEventListener("error", disconnected);
    },
    send(peerId, wire) {
      const channel = peerConnections.get(peerId)?.channel;
      if (channel && channel.readyState === "open") {
        sendOnChannel(peerId, channel, wire);
      }
    },
    broadcast(wire) {
      for (const [peerId, entry] of peerConnections) {
        if (entry.channel && entry.channel.readyState === "open") {
          sendOnChannel(peerId, entry.channel, wire);
        }
      }
    },
    disconnect() {
      clearPingTimer();
      for (const peerId of [...offerRetryTimers.keys()]) clearOfferRetry(peerId);
      offerRetries.clear();
      for (const peerId of [...peerConnections.keys()]) closePeer(peerId);
      reassemblers.clear();
      sendTail.clear();
      pendingIceCandidates.clear();
      signalingRoster.clear();
      const closingSocket = socket;
      socket = null;
      try {
        closingSocket?.close();
      } catch {
        // ignore
      }
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
    pingIntervalMs: options.pingIntervalMs,
    WebSocketImpl: options.WebSocketImpl,
    createPeerConnection: options.createPeerConnection,
    onDiagnostic: options.onDiagnostic,
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
