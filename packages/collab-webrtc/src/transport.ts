/** Networking boundary used by the collaboration provider. */
export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface TransportHandlers {
  onStatus(status: ConnectionStatus): void;
  onPeerOpen(peerId: string): void;
  onPeerClose(peerId: string): void;
  onMessage(peerId: string, wire: string): void;
  /** Peers seen via signaling (joined/peer), before a data channel opens. */
  onSignalingRoster?(peerIds: string[]): void;
}

/**
 * A transport is responsible for peer discovery (via signaling) and delivering
 * opaque `wire` strings between peers. The provider layers Yjs sync, awareness,
 * and encryption on top and never talks to signaling or WebRTC directly.
 */
export interface CollabTransport {
  connect(localPeerId: string, handlers: TransportHandlers): void;
  send(peerId: string, wire: string): void;
  broadcast(wire: string): void;
  disconnect(): void;
}
