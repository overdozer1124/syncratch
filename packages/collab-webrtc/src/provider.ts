/**
 * @experimental Yjs collaboration provider over a pluggable transport.
 *
 * Responsibilities:
 *   - Yjs sync protocol (state-vector exchange + incremental updates).
 *   - Awareness/presence limited to random participant ids (no names, emails,
 *     tokens, roster, or Drive permissions).
 *   - Payload encryption with the room secret (see `wire.ts`).
 *   - Connection state, peer membership, clean disconnect.
 *
 * Remote updates are gated through `applyRemoteUpdate`, letting the editor plug
 * in schema/limit validation so invalid remote state is never accepted. Origin
 * tracking (`isLocalOrigin`) ensures only local edits are broadcast, so applied
 * remote updates never loop back.
 */
import * as Y from "yjs";
import {
  createRoomCipher,
  decodeChannelMessage,
  encodeChannelMessage,
  FRAME_AWARENESS,
  FRAME_SYNC_STEP1,
  FRAME_SYNC_STEP2,
  FRAME_UPDATE,
  type RoomCipher,
} from "./wire.js";
import type {CollabTransport, ConnectionStatus, TransportHandlers} from "./transport.js";

export const REMOTE_APPLY_ORIGIN: unique symbol = Symbol("blocksync-webrtc-remote");

export type AwarenessState = {participantId: string} & Record<string, unknown>;

export interface CollabProviderOptions {
  doc: Y.Doc;
  secret: string;
  transport: CollabTransport;
  participantId?: string;
  randomId?: () => string;
  /** Apply (and optionally validate) a remote update. Returns whether accepted. */
  applyRemoteUpdate?: (update: Uint8Array) => boolean;
  /** Whether a doc update origin represents a LOCAL edit that should be broadcast. */
  isLocalOrigin?: (origin: unknown) => boolean;
  /** Extra non-identifying presence fields to advertise. */
  presence?: Record<string, unknown>;
}

type ProviderEvent = "status" | "peers" | "awareness" | "signaling";

export interface CollabProvider {
  readonly participantId: string;
  connect(): void;
  disconnect(): void;
  destroy(): void;
  getStatus(): ConnectionStatus;
  getPeers(): string[];
  /** Peers announced by signaling before a data channel is open. */
  getSignalingPeers(): string[];
  getAwareness(): Map<string, AwarenessState>;
  setPresence(presence: Record<string, unknown>): void;
  on(event: ProviderEvent, listener: () => void): void;
  off(event: ProviderEvent, listener: () => void): void;
  onOutgoingUpdate(listener: () => void): void;
  flush(): Promise<void>;
}

function randomParticipantId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return `p-${s}`;
}

export function createCollabProvider(options: CollabProviderOptions): CollabProvider {
  const {doc, transport} = options;
  const participantId = options.participantId ?? (options.randomId?.() ?? randomParticipantId());
  const applyRemoteUpdate =
    options.applyRemoteUpdate ??
    ((update: Uint8Array): boolean => {
      Y.applyUpdate(doc, update, REMOTE_APPLY_ORIGIN);
      return true;
    });
  const isLocalOrigin =
    options.isLocalOrigin ?? ((origin: unknown): boolean => origin !== REMOTE_APPLY_ORIGIN);

  let status: ConnectionStatus = "disconnected";
  let cipher: RoomCipher | null = null;
  let pending: Promise<void> = Promise.resolve();
  const peers = new Set<string>();
  const signalingPeers = new Set<string>();
  const awareness = new Map<string, AwarenessState>();
  let presence: Record<string, unknown> = {...options.presence};
  const listeners: Record<ProviderEvent, Set<() => void>> = {
    status: new Set(),
    peers: new Set(),
    awareness: new Set(),
    signaling: new Set(),
  };
  const outgoing = new Set<() => void>();
  let connected = false;
  let transportStarted = false;

  const emit = (event: ProviderEvent): void => {
    for (const listener of listeners[event]) listener();
  };

  const enqueue = (task: () => Promise<void>): void => {
    pending = pending.then(task).catch(() => undefined);
  };

  const localAwareness = (): AwarenessState => ({participantId, online: true, ...presence});

  const getCipher = async (): Promise<RoomCipher> => {
    if (!cipher) cipher = await createRoomCipher(options.secret);
    return cipher;
  };

  const sendTo = (peerId: string, wire: string): void => transport.send(peerId, wire);

  const sendSyncStep1 = (peerId: string): void => {
    enqueue(async () => {
      const c = await getCipher();
      const sv = Y.encodeStateVector(doc);
      sendTo(peerId, await encodeChannelMessage(c, {kind: FRAME_SYNC_STEP1, payload: sv}));
    });
  };

  const sendAwarenessTo = (peerId: string): void => {
    enqueue(async () => {
      const c = await getCipher();
      sendTo(peerId, await encodeChannelMessage(c, {kind: FRAME_AWARENESS, payload: localAwareness()}));
    });
  };

  const broadcastAwareness = (): void => {
    enqueue(async () => {
      const c = await getCipher();
      transport.broadcast(await encodeChannelMessage(c, {kind: FRAME_AWARENESS, payload: localAwareness()}));
    });
  };

  const handlers: TransportHandlers = {
    onStatus(next) {
      status = next;
      if (next === "disconnected" && connected) {
        connected = false;
        doc.off("update", onDocUpdate);
        peers.clear();
        signalingPeers.clear();
        awareness.clear();
        emit("peers");
        emit("signaling");
        emit("awareness");
      }
      emit("status");
    },
    onPeerOpen(peerId) {
      peers.add(peerId);
      sendSyncStep1(peerId);
      sendAwarenessTo(peerId);
      emit("peers");
    },
    onPeerClose(peerId) {
      peers.delete(peerId);
      if (awareness.delete(peerId)) emit("awareness");
      emit("peers");
    },
    onSignalingRoster(peerIds) {
      signalingPeers.clear();
      for (const peerId of peerIds) signalingPeers.add(peerId);
      emit("signaling");
    },
    onMessage(peerId, wire) {
      enqueue(async () => {
        const c = await getCipher();
        let message;
        try {
          message = await decodeChannelMessage(c, wire);
        } catch {
          return; // Wrong secret or tampered; ignore.
        }
        switch (message.kind) {
          case FRAME_SYNC_STEP1: {
            const remoteSv = message.payload as Uint8Array;
            const update = Y.encodeStateAsUpdate(doc, remoteSv);
            sendTo(
              peerId,
              await encodeChannelMessage(c, {kind: FRAME_SYNC_STEP2, payload: update}),
            );
            return;
          }
          case FRAME_SYNC_STEP2:
          case FRAME_UPDATE: {
            applyRemoteUpdate(message.payload as Uint8Array);
            return;
          }
          case FRAME_AWARENESS: {
            const state = message.payload as AwarenessState | null;
            if (state && typeof state.participantId === "string") {
              awareness.set(peerId, state);
              emit("awareness");
            }
            return;
          }
        }
      });
    },
  };

  const onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (!connected) return;
    if (!isLocalOrigin(origin)) return;
    enqueue(async () => {
      const c = await getCipher();
      transport.broadcast(await encodeChannelMessage(c, {kind: FRAME_UPDATE, payload: update}));
      for (const listener of outgoing) listener();
    });
  };

  return {
    participantId,
    connect() {
      if (connected) return;
      if (transportStarted) {
        transport.disconnect();
        transportStarted = false;
      }
      connected = true;
      doc.on("update", onDocUpdate);
      transportStarted = true;
      transport.connect(participantId, handlers);
    },
    disconnect() {
      if (!transportStarted) return;
      connected = false;
      doc.off("update", onDocUpdate);
      transport.disconnect();
      transportStarted = false;
      peers.clear();
      signalingPeers.clear();
      awareness.clear();
      emit("peers");
      emit("signaling");
      emit("awareness");
    },
    destroy() {
      this.disconnect();
      for (const set of Object.values(listeners)) set.clear();
      outgoing.clear();
    },
    getStatus() {
      return status;
    },
    getPeers() {
      return [...peers].sort();
    },
    getSignalingPeers() {
      return [...signalingPeers].sort();
    },
    getAwareness() {
      return new Map(awareness);
    },
    setPresence(next) {
      presence = {...next};
      if (connected) broadcastAwareness();
    },
    on(event, listener) {
      listeners[event].add(listener);
    },
    off(event, listener) {
      listeners[event].delete(listener);
    },
    onOutgoingUpdate(listener) {
      outgoing.add(listener);
    },
    flush() {
      return pending;
    },
  };
}
