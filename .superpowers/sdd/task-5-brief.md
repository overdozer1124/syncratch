# Task 5: Yjs/WebRTC collaboration and leader Drive persistence

## Goal

Add small-room peer-to-peer collaboration to the static editor. All participants authenticate with Google and verify access to the same Picker-authorized Drive file. Yjs/WebRTC carries live project updates; a deterministic best-effort leader alone performs durable Drive snapshots.

## Collaboration domain

Extend `@blocksync/collaboration-domain` without breaking its existing Gate 0 API:

- Add a full Local-First project collaboration model for schema 2 ProjectDocument and content-addressed asset bytes.
- Use Yjs maps at a target-level or finer granularity so concurrent edits to different Scratch targets merge. Do not store the entire project as one last-write-wins JSON blob.
- Synchronize ProjectDocument metadata, targets, and asset bytes. Validate materialized documents before applying them to the editor.
- Enforce the existing 5 MiB project/SB3 boundary, asset count/byte limits, safe canonical JSON keys, and typed-array checks before accepting remote state.
- Track transaction/update origin to prevent VM→Yjs→VM feedback loops.
- Document the remaining same-target conflict semantics.

## WebRTC provider

Create a browser-only collaboration transport package:

- Use Yjs with WebRTC data channels and a configurable signaling URL. Never fall back to public signaling servers.
- Room invitation data contains a random room ID, random high-entropy secret, and Drive file ID in the URL fragment only. It must not enter request URLs, logs, Drive payload, `.sb3`, IndexedDB project content, or signaling messages.
- Derive the signaling topic from a one-way hash. Use the room secret for provider encryption where supported.
- Expose connection state, peer membership, awareness/presence with random participant IDs only, and clean disconnect.
- No names, emails, Google tokens, roster, or complete Drive permissions in awareness/signaling.
- Require configured signaling before room creation/join. WebRTC failure degrades to local editing/export; it must not claim remote save success.

## Signaling

Add a minimal deployable free-tier signaling service compatible with the chosen provider:

- Stateless/ephemeral room routing only; no Yjs updates or project snapshots at rest.
- Validate message size, allowed message shape, topic length, connection/room limits, and idle expiry.
- Provide a local test adapter/server so two real Chromium contexts can establish a room in E2E.
- Document Cloudflare Worker/Durable Object or equivalent free-tier deployment and the fact that TURN may still be required on restrictive school networks.

## Editor integration

- Controls/status: Create room, Join invite, Copy invite, Leave; peer count and leader/follower state.
- Creating/joining requires: Google connected, current project linked to a Drive file, successful metadata/read permission check, and configured signaling.
- A joiner imports/opens the shared Drive file before attaching to the Y.Doc.
- Bind VM changes to Yjs with a generation-safe debounce. Valid remote Yjs state updates the same local project/VM and persists through the existing IndexedDB path without feedback loops.
- All peers keep local IndexedDB copies and `.sb3` export.
- Determine leader from authenticated/eligible awareness participants using a deterministic function over the current membership. Derive a leadership epoch from room ID, leader participant ID, and the sorted eligible membership.
- Only the current leader may trigger background/explicit Drive snapshots. Refactor Task 4 to pass the leadership epoch instead of hardcoded epoch 0.
- On leader departure, remaining peers elect deterministically and the new leader re-observes Drive metadata/hash before writing.
- On partition/split-brain/Drive conflict, stop automatic Drive saving, show conflict, retain each local copy, and require reconnection/reconciliation. Do not claim strict distributed locking.

## Tests

Use TDD and include:

- project/asset materialization and validation, different-target merge, same-target documented conflict, update-loop prevention;
- invitation fragment encoding/decoding, entropy source injection, topic derivation, no secret/file ID in signaling topic;
- no public signaling default and no token/identity leakage;
- deterministic leader/epoch, join/leave handoff, only leader writes;
- two real browser contexts editing different sprites and converging through WebRTC;
- reload/local recovery and `.sb3` export on each peer;
- signaling outage and forced peer disconnect degrade safely;
- Drive pre/post conflict stops leader snapshots without local data loss.

Run collaboration packages, editor unit/typecheck/build/E2E, Drive package, local store/SB3 tests, existing Gate 0 collaboration tests, workspace build, and production audit.

## Constraints

- No centralized project relay/storage, public signaling fallback, TURN service purchase, Apps Script, School Server, or broad Google scope.
- Do not imply WebRTC works on every school network.
- Do not identify users through Google profile data.
- Preserve solo/local/Drive-only operation when collaboration is not configured.
- Conventional Commits; write `.superpowers/sdd/task-5-report.md`.
