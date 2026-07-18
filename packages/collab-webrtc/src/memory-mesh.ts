/**
 * In-memory, fully-connected mesh of transports for tests and local demos.
 * It exercises the provider's sync/awareness/encryption logic without real
 * WebRTC. Real deployments use `createWebRtcTransport`.
 */
import type {CollabTransport, TransportHandlers} from "./transport.js";

interface Node {
  peerId: string;
  handlers: TransportHandlers;
}

export interface MemoryMesh {
  createTransport(): CollabTransport;
}

export function createMemoryMesh(): MemoryMesh {
  const nodes = new Map<string, Node>();

  function createTransport(): CollabTransport {
    let self: Node | null = null;
    return {
      connect(localPeerId, handlers) {
        self = {peerId: localPeerId, handlers};
        handlers.onStatus("connecting");
        nodes.set(localPeerId, self);
        for (const other of nodes.values()) {
          if (other.peerId === localPeerId) continue;
          other.handlers.onPeerOpen(localPeerId);
          handlers.onPeerOpen(other.peerId);
        }
        handlers.onStatus("connected");
      },
      send(peerId, wire) {
        if (!self) return;
        nodes.get(peerId)?.handlers.onMessage(self.peerId, wire);
      },
      broadcast(wire) {
        if (!self) return;
        for (const other of nodes.values()) {
          if (other.peerId === self.peerId) continue;
          other.handlers.onMessage(self.peerId, wire);
        }
      },
      disconnect() {
        if (!self) return;
        const {peerId} = self;
        nodes.delete(peerId);
        for (const other of nodes.values()) {
          other.handlers.onPeerClose(peerId);
        }
        self.handlers.onStatus("disconnected");
        self = null;
      },
    };
  }

  return {createTransport};
}
