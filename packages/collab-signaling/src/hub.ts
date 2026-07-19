/**
 * @experimental Stateless/ephemeral WebRTC signaling hub.
 *
 * The hub routes WebRTC handshake messages (offer/answer/ICE, opaque `data`)
 * between peers that share a hashed topic. It never stores Yjs updates or
 * project snapshots at rest and never inspects `data`; it only holds ephemeral
 * in-memory topic membership so it can relay and clean up. All transport is
 * abstracted behind SignalingConnection so the routing/validation logic is
 * fully unit-testable without a real socket.
 */

export interface SignalingConnection {
  /** Unique transport-level connection id (not the peer id). */
  readonly id: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SignalingLimits {
  maxMessageBytes: number;
  maxTopicLength: number;
  maxPeerIdLength: number;
  maxPeersPerTopic: number;
  maxTopics: number;
  maxConnections: number;
  idleMs: number;
  maxMessagesPerWindow: number;
  rateWindowMs: number;
}

export const DEFAULT_SIGNALING_LIMITS: SignalingLimits = {
  maxMessageBytes: 64 * 1024,
  maxTopicLength: 128,
  maxPeerIdLength: 64,
  maxPeersPerTopic: 8,
  maxTopics: 2000,
  maxConnections: 500,
  idleMs: 60_000,
  maxMessagesPerWindow: 120,
  rateWindowMs: 10_000,
};

const TOPIC_PATTERN = /^[A-Za-z0-9_-]+$/;
const PEER_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface SignalingHubOptions extends Partial<SignalingLimits> {
  now?: () => number;
}

interface Member {
  conn: SignalingConnection;
  topic: string;
  peer: string;
  lastSeen: number;
  rateWindowStartedAt: number;
  messagesInWindow: number;
}

function byteLength(raw: string | Uint8Array): number {
  return typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
}

export class SignalingHub {
  private readonly limits: SignalingLimits;
  private readonly now: () => number;
  private readonly members = new Map<string, Member>();
  private readonly topics = new Map<string, Map<string, Member>>();

  constructor(options: SignalingHubOptions = {}) {
    this.limits = {...DEFAULT_SIGNALING_LIMITS, ...options};
    this.now = options.now ?? Date.now;
  }

  handleConnection(conn: SignalingConnection): void {
    if (this.members.size >= this.limits.maxConnections) {
      conn.close(1013, "connection limit reached");
      return;
    }
    const connectedAt = this.now();
    this.members.set(conn.id, {
      conn,
      topic: "",
      peer: "",
      lastSeen: connectedAt,
      rateWindowStartedAt: connectedAt,
      messagesInWindow: 0,
    });
  }

  handleClose(conn: SignalingConnection): void {
    const member = this.members.get(conn.id);
    this.members.delete(conn.id);
    if (!member || !member.topic) return;
    this.removeFromTopic(member);
  }

  private removeFromTopic(member: Member): void {
    const room = this.topics.get(member.topic);
    if (!room) return;
    room.delete(member.peer);
    for (const other of room.values()) {
      other.conn.send(JSON.stringify({t: "leave", topic: member.topic, peer: member.peer}));
    }
    if (room.size === 0) this.topics.delete(member.topic);
  }

  private error(conn: SignalingConnection, reason: string): void {
    conn.send(JSON.stringify({t: "error", reason}));
  }

  handleMessage(conn: SignalingConnection, raw: string | Uint8Array): void {
    if (byteLength(raw) > this.limits.maxMessageBytes) {
      conn.close(1009, "message too large");
      this.handleClose(conn);
      return;
    }
    const member = this.members.get(conn.id);
    if (!member) return;
    const now = this.now();
    member.lastSeen = now;
    if (now - member.rateWindowStartedAt >= this.limits.rateWindowMs) {
      member.rateWindowStartedAt = now;
      member.messagesInWindow = 0;
    }
    member.messagesInWindow += 1;
    if (member.messagesInWindow > this.limits.maxMessagesPerWindow) {
      conn.close(1008, "message rate exceeded");
      this.handleClose(conn);
      return;
    }

    const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      this.error(conn, "invalid_json");
      return;
    }
    if (typeof msg !== "object" || msg === null) {
      this.error(conn, "invalid_message");
      return;
    }
    const record = msg as Record<string, unknown>;
    switch (record.t) {
      case "ping":
        conn.send(JSON.stringify({t: "pong"}));
        return;
      case "join":
        this.onJoin(conn, member, record);
        return;
      case "signal":
        this.onSignal(conn, member, record);
        return;
      default:
        this.error(conn, "unknown_type");
    }
  }

  private onJoin(
    conn: SignalingConnection,
    member: Member,
    record: Record<string, unknown>,
  ): void {
    const {topic, peer} = record;
    if (
      typeof topic !== "string" ||
      topic.length === 0 ||
      topic.length > this.limits.maxTopicLength ||
      !TOPIC_PATTERN.test(topic)
    ) {
      this.error(conn, "invalid_topic");
      return;
    }
    if (
      typeof peer !== "string" ||
      peer.length === 0 ||
      peer.length > this.limits.maxPeerIdLength ||
      !PEER_PATTERN.test(peer)
    ) {
      this.error(conn, "invalid_peer");
      return;
    }
    if (member.topic) {
      this.error(conn, "already_joined");
      return;
    }
    let room = this.topics.get(topic);
    if (!room) {
      if (this.topics.size >= this.limits.maxTopics) {
        this.error(conn, "topic_limit");
        return;
      }
      room = new Map();
      this.topics.set(topic, room);
    }
    if (room.size >= this.limits.maxPeersPerTopic) {
      this.error(conn, "room_full");
      if (room.size === 0) this.topics.delete(topic);
      return;
    }
    if (room.has(peer)) {
      this.error(conn, "duplicate_peer");
      return;
    }
    member.topic = topic;
    member.peer = peer;
    const peers = [...room.keys()];
    room.set(peer, member);
    conn.send(JSON.stringify({t: "joined", topic, peers}));
    for (const other of room.values()) {
      if (other.peer !== peer) {
        other.conn.send(JSON.stringify({t: "peer", topic, peer}));
      }
    }
  }

  private onSignal(
    conn: SignalingConnection,
    member: Member,
    record: Record<string, unknown>,
  ): void {
    if (!member.topic) {
      this.error(conn, "not_joined");
      return;
    }
    const {to, data, topic} = record;
    if (topic !== member.topic) {
      this.error(conn, "topic_mismatch");
      return;
    }
    if (typeof to !== "string" || !("data" in record)) {
      this.error(conn, "invalid_signal");
      return;
    }
    const room = this.topics.get(member.topic);
    const target = room?.get(to);
    if (!target) {
      this.error(conn, "unknown_peer");
      return;
    }
    target.conn.send(
      JSON.stringify({t: "signal", topic: member.topic, from: member.peer, data}),
    );
  }

  /** Close connections whose last activity exceeds the idle limit. */
  sweepIdle(nowMs = this.now()): void {
    for (const member of [...this.members.values()]) {
      if (nowMs - member.lastSeen > this.limits.idleMs) {
        member.conn.close(1000, "idle timeout");
        this.handleClose(member.conn);
      }
    }
  }

  stats(): {connections: number; topics: number; peers: number} {
    let peers = 0;
    for (const room of this.topics.values()) peers += room.size;
    return {connections: this.members.size, topics: this.topics.size, peers};
  }
}
