# @blocksync/collab-signaling

EXPERIMENTAL stateless/ephemeral WebRTC **signaling** relay for small-room
collaboration. It routes the WebRTC handshake (SDP offers/answers and ICE
candidates, carried as an opaque `data` payload) between peers that share a
**hashed topic**.

## What it is not

- It is **not** a project relay or storage. It never stores Yjs updates or
  project snapshots at rest, and never inspects the `data` payload.
- It is **not** a TURN server. On restrictive networks (e.g. some school
  networks) WebRTC may fail even with signaling working; a TURN server would be
  required, which this project intentionally does not purchase or provide.
  Collaboration degrades to local editing/export in that case.

## Protocol

Client → server:

- `{ "t": "join", "topic": "<hashed topic>", "peer": "<random peer id>" }`
- `{ "t": "signal", "topic": "<topic>", "to": "<peer id>", "data": <opaque> }`
- `{ "t": "ping" }`

Server → client:

- `{ "t": "joined", "topic", "peers": ["<existing peer ids>"] }`
- `{ "t": "peer", "topic", "peer" }` — a peer joined
- `{ "t": "leave", "topic", "peer" }` — a peer left
- `{ "t": "signal", "topic", "from": "<peer id>", "data": <opaque> }`
- `{ "t": "pong" }`
- `{ "t": "error", "reason" }`

The topic is a one-way hash (see `@blocksync/collab-invite`); the room secret and
Drive file id are never sent to the signaling server. Peer ids are random and
carry no name/email/token/roster.

## Limits (validated)

Message size, topic length/charset, peer-id length/charset, peers-per-topic,
topic count, connection count, and idle expiry. See `DEFAULT_SIGNALING_LIMITS`.

## Local test server

```bash
pnpm --filter @blocksync/collab-signaling start   # PORT env, default 4444
```

Two real Chromium contexts connect to this server to establish a room in E2E.

## Free-tier deployment (Cloudflare Worker + Durable Object)

The routing logic maps directly onto a Worker that upgrades WebSocket
connections and forwards them to a Durable Object keyed by `topic`. The DO holds
only ephemeral membership (the same `SignalingHub` semantics) and relays
`signal` messages; it persists nothing. Equivalent free-tier options (Deno
Deploy, Fly.io free allowance, a tiny always-on Node process) work the same way
because the server is stateless per message.
