# Task 5 Report — Small-room P2P collaboration (Yjs/WebRTC + leader Drive)

Branch: `feat/local-first-pivot-impl`

## Status

DONE_WITH_CONCERNS — the collaboration foundation (domain, invite, leader,
signaling, WebRTC transport, editor orchestration) and a real two-context
Chromium WebRTC E2E are implemented, tested, and committed. The editor GUI
wiring (`main.ts`, `index.html`, `style.css`, `editor.spec.ts` and follow-up
edits to `collab-session.ts`/`drive-integration.ts`) exists in the working tree
and is green, but was authored by a **concurrent writer** and is intentionally
left uncommitted (see Concerns).

## What was built (committed)

Commit range (Task 5 only): `4b8d330..d29fb9d` on `feat/local-first-pivot-impl`.

1. `4b8d330 feat(collab): add invite, leader election, and schema-2 project domain`
   - `@blocksync/collab-invite`: invitation model with high-entropy room secret,
     URL **fragment** encoding (secret + Drive file id never hit the query/path,
     server logs, or Referer), `parseInviteFromUrl`, and a one-way
     SHA-256-derived `deriveSignalingTopic` so the signaling relay only ever sees
     an opaque topic — not the room secret or Drive id.
   - `@blocksync/collab-leader`: deterministic `electLeader` (stable ordering,
     eligibility filter), `deriveLeadershipEpoch` (FNV-1a over room+leader), and
     `isLeader`. No coordination round-trips required.
   - `@blocksync/collaboration-domain` (extended, additive): schema-2 project
     collaboration model with **target-granular** `Y.Map` and content-addressed
     assets, canonical-JSON key ordering, origin tagging to break VM→Yjs→VM
     loops, and validation reusing existing limits (5 MiB project cap, asset
     count/byte caps, typed-array/canonical-key safety). Gate 0 consumers
     unaffected.

2. `762e699 feat(collab): add stateless ephemeral WebRTC signaling relay`
   - `@blocksync/collab-signaling`: a stateless topic-scoped relay (`SignalingHub`
     + `ws` server). It relays offer/answer/ICE only, stores no document data,
     enforces per-topic peer caps and message-size/rate limits, and sweeps idle
     sockets. Ships a local test adapter and a README documenting the protocol,
     limits, and a free-tier Cloudflare Worker + Durable Object deployment.

3. `644f667 feat(collab): add browser Yjs/WebRTC transport with encrypted channels`
   - `@blocksync/collab-webrtc`: browser-only transport. **Public signaling
     fallback is explicitly disabled** — the signaling URL is required and
     validated (ws/wss only), there is no default/public server, and there is no
     STUN/TURN fallback baked in (ICE servers are caller-provided). Yjs update
     and awareness frames are encrypted with AES-GCM using a key derived
     (SHA-256) from the room secret, so the relay and any network observer see
     only ciphertext. Includes an in-memory mesh for deterministic provider
     tests and an `onDiagnostic` hook plus surfaced async
     offer/answer/candidate errors.

4. `a84d1c9 feat(editor): add collaboration session orchestration and leader epoch`
   - `apps/editor-web/src/collab-session.ts`: `evaluateCollabReadiness`
     (requires Google connected + a Drive file id + a configured signaling URL)
     and `createCollabSession` orchestrating the Yjs doc, provider, deterministic
     leader election, leadership epoch, VM↔Yjs binding, remote-apply, conflict
     state, and local persistence.
   - `drive-integration.ts`: consumes the Task-4 epoch via `getLeadershipEpoch`
     and gates writes with `canPersistToDrive` so **only the elected leader**
     writes Drive snapshots; solo behavior is unchanged (epoch `"0"`, writes
     allowed).

5. `d29fb9d test(editor): real two-context Chromium WebRTC convergence E2E`
   - `apps/editor-web/collab-harness.html` + `collab-harness.ts`: a minimal
     harness exposing `window.__collab`.
   - `apps/editor-web/e2e/collab.spec.ts`: opens **two real Chromium contexts**,
     connects them through the local signaling server over real
     `RTCPeerConnection` data channels (loopback ICE, no STUN/TURN), and asserts
     that concurrent edits to **different sprites** converge on both peers.
   - Playwright config runs a second web server for the signaling relay and adds
     `--disable-features=WebRtcHideLocalIpsWithMdns` so headless Chromium exposes
     loopback candidates.

## Verification (all green)

- `@blocksync/collab-invite` unit: 12 passed
- `@blocksync/collab-leader` unit: 11 passed
- `@blocksync/collab-signaling` unit: 13 passed
- `@blocksync/collab-webrtc` unit: 20 passed; typecheck clean
- `@blocksync/collaboration-domain` unit: 13 passed (Gate 0 unaffected)
- Gate 0 regression: `gate0-collab-server` 6 passed, `gate0-collab-demo` 2 passed
- `apps/editor-web` unit: 61 passed (incl. collab-session 7, drive-integration 30)
- `apps/editor-web` typecheck: clean
- `apps/editor-web` production build: clean (emits `index.html` +
  `collab-harness.html`)
- **Real 2-context Chromium E2E** (`collab.spec.ts`): 1 passed (~9.7s) — peers
  reach `ice=connected` / `pc=connected`, data channels open, sprites converge.

## Design / safety notes

- Secrets and Drive file ids travel only in the URL fragment and are never sent
  to the signaling relay (topic is a one-way hash) or over the wire in plaintext
  (AES-GCM channel encryption).
- No public signaling and no implicit STUN/TURN: the transport refuses to start
  without an explicit, validated signaling URL.
- Leader-only Drive persistence via deterministic election + epoch; non-leaders
  are gated out, avoiding snapshot races.
- All collaboration-domain additions are additive; existing Gate 0
  server/demo/schema APIs are untouched and still pass.

## Concerns

1. **Concurrent authorship of the editor GUI wiring.** The working tree contains
   uncommitted edits to `apps/editor-web/src/main.ts`, `index.html`, `style.css`,
   `e2e/editor.spec.ts`, and follow-up edits to `collab-session.ts` /
   `drive-integration.ts` that I did **not** author — my committed files were
   modified again after my commits, indicating another active writer is wiring
   the room controls / join flow / test gate. That work currently typechecks and
   all unit tests pass, but because it is being edited live I deliberately did
   **not** commit it to avoid capturing an inconsistent mid-edit snapshot. It
   should be reviewed and committed deliberately by its author.
2. **Live GUI collaboration path not E2E-verified end-to-end.** The real WebRTC
   convergence is verified via the dedicated 2-context harness E2E. The
   full-GUI host/join flow through the Scratch VM depends on Google/Drive and is
   not exercised by an automated E2E here; it is covered indirectly by
   `collab-session` unit tests and the transport E2E.
3. **Uncommitted brief/progress files** (`task-*-brief.md`, `progress.md`,
   `task-*-review-package.txt`) and this report were left unstaged per
   instruction.

## Final addendum — 2026-07-19

The concurrent editor wiring was taken over, reviewed, corrected, and verified.
Task 5 is now complete without the concerns above:

- Full editor host/join uses the configured signaling port and passes two-real-
  Chromium-context convergence.
- Pending local edits are pushed before remote VM replacement.
- Target IDs survive Scratch target renames, and target deletions propagate.
- Content-addressed asset hashes are cached instead of recomputed per change.
- A follower cannot independently seed before receiving host state.
- The E2E harness is excluded from production builds.
- Signaling has connection-level message-rate limiting.
- Leader departure, local recovery, signaling outage, reload persistence, and
  SB3 export pass the release browser suite.

Final verification: editor unit 70 passed, collaboration package tests passed,
Playwright 10 passed, production build and static artifact verification passed.
