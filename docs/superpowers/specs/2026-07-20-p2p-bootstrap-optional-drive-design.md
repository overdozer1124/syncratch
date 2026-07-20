# Drive-independent Collaboration Bootstrap Design

**Status:** Approved for implementation  
**Scope:** P0 stage 1 only  
**Date:** 2026-07-20

## 1. Goal

Allow a host to start a collaboration room and a guest to join it without
Google authentication, Drive sharing, or Picker access. The guest receives a
verified project over the existing encrypted Yjs/WebRTC path, creates a new
local copy, and only then begins editing.

Drive becomes an optional backup owned by the device that created the room.
It is not an input to room admission or guest bootstrap.

## 2. Decisions

1. New invites contain only `roomId` and `secret`. Old invites containing
   `driveFileId` still decode, but the file id is ignored during Join.
2. The existing Yjs/WebRTC transport, chunk framing, and backpressure remain.
   No public signaling fallback, central project service, second data channel,
   or Drive scope expansion is added.
3. Bootstrap completion is an in-band Y.Doc application contract. It is not
   inferred from transport silence or asset presence alone.
4. Incoming collaboration state lives in a staging Y.Doc. VM and IndexedDB are
   downstream of materialization and validation.
5. The room-creating device is the only Drive writer in stage 1. Awareness,
   participant ordering, and peer-provided role claims are not authorization.
6. A guest's previously open local project is never overwritten by Join.
7. General repair of an already-corrupt local record is stage 2. Unified
   Local/Drive/Collab status presentation is stage 3.

## 3. Non-goals

- Automatic Drive-writer handoff after the room creator leaves
- Guest Drive backup while the guest remains in the room
- Automatic signaling reconnection
- A new manifest transport or separate asset channel
- Resuming an incomplete bootstrap after a tab is closed
- Malicious-editor isolation after an invite secret has been shared
- General recovery of missing assets in an existing local project

## 4. Terminology and trust boundary

- **Room creator:** the local session that called `start({host: true})`.
- **Guest:** a local session that called `start({host: false})`.
- **Staging Y.Doc:** the session document that receives remote Yjs updates.
  Its contents are not user-visible until validation and local persistence
  succeed.
- **Bootstrap sealer:** the room creator. It publishes bootstrap checkpoints
  for late joiners. This is a coordination role, not a security identity.
- **Drive writer:** a local capability held only by the room-creating device.
  It cannot be granted through Yjs or awareness data.

All peers holding the room secret may edit shared project content. This design
does not treat bootstrap metadata as a defense against a malicious invited
editor. It does ensure that peer-controlled `host` or `eligible` claims cannot
enable Drive writes on another device.

## 5. In-band bootstrap contract

The collaboration Y.Doc gains a `bootstrap` map with this logical shape:

```ts
type BootstrapState = "seeding" | "sealed";

interface BootstrapAsset {
  md5ext: string;
  contentSha256: string;
  byteLength: number;
}

interface BootstrapCheckpoint {
  bootstrapId: string;
  state: BootstrapState;
  projectTitle?: string;
  contentStateVector?: string;
  documentHash?: string;
  assetManifest?: BootstrapAsset[];
}
```

`assetManifest` is sorted by `md5ext` and contains exactly one entry for each
distinct costume or sound asset referenced by the checkpoint document.
`documentHash` is the existing canonical ProjectDocument content hash.
`contentStateVector` is the base64url-encoded Yjs state vector captured after
all content operations represented by the checkpoint and immediately before
the transaction that writes `sealed`. `projectTitle` is limited to 200 Unicode
code points; an absent or invalid title uses a collaboration fallback.

### 5.1 Initial seal

Before connecting the room creator:

1. Materialize the current VM document and runtime assets.
2. Run the complete host preflight in section 7.
3. In one local Yjs transaction, write a fresh `bootstrapId` in `seeding`
   state, the project, and all assets.
4. Capture the resulting Yjs state vector.
5. In a second local transaction, write the state vector, document hash,
   manifest, title, and `sealed`.
6. Connect the provider.

The first Yjs state sync therefore contains a sealed, self-describing
checkpoint even though it was assembled locally in two transactions before
connection. Transport chunks are not themselves the completion signal.
After this transaction succeeds, the creator's local bootstrap state is
`ready`; the creator does not traverse the guest state machine.

### 5.2 Rolling seal while a guest is joining

The room creator remains the bootstrap sealer. Whenever local or remote project
edits change the creator's staging Y.Doc:

1. Publish a fresh `bootstrapId` with state `seeding`.
2. Wait until the current staging document materializes successfully.
3. Compute the current canonical document hash and exact asset manifest.
4. Capture the current Yjs state vector.
5. Publish `contentStateVector`, `documentHash`, `assetManifest`, and state
   `sealed` atomically.

Sealing is debounced with the existing collaboration update debounce. If a
newer edit arrives while sealing, the older generation is abandoned and a new
generation is sealed. Guests only evaluate the latest generation.

This rolling checkpoint allows a host edit during bootstrap to converge to one
final consistent state. If the room creator leaves, already-ready peers may
continue editing locally and through P2P, but no new trusted checkpoint is
promised in stage 1. A bootstrapping guest then enters `stalled-project`.
Readiness therefore requires a short period in which edits converge and the
creator can publish a matching seal. Continuous editing may keep a new guest
in `receiving-project`; visible progress prevents this from being reported as
an integrity failure.

## 6. Guest bootstrap state machine

```text
idle
  -> receiving-project
  -> verifying-project
  -> saving-local-copy
  -> ready

receiving-project | verifying-project
  -> stalled-project
  -> invalid-project

stalled-project
  -> receiving-project

saving-local-copy
  -> local-save-failed
  -> ready
```

### 6.1 Staging flow

```text
WebRTC encrypted updates
  -> frame/chunk limits
  -> staging Y.Doc
  -> latest sealed checkpoint
  -> materialize and validate
  -> atomically create new LocalProjectRecord
  -> load VM
  -> ready
```

While the guest is not `ready`:

- `noteLocalChange()` does not publish project edits.
- Scratch editing controls are disabled.
- The previously open project and its Drive link remain unchanged.
- Leave is always available.

The guest becomes `ready` only when all of these match the same latest sealed
generation:

1. The staging Y.Doc state vector contains every client clock in the
   checkpoint's `contentStateVector`.
2. The ProjectDocument passes schema and safe-key validation.
3. Its canonical hash equals `documentHash`.
4. Its distinct referenced assets exactly equal `assetManifest`.
5. Every referenced asset exists in the staging Y.Doc.
6. Every actual byte length equals the manifest byte length.
7. Every SHA-256 equals both the manifest digest and the corresponding document
   reference's `contentSha256`.
8. All project, asset, update, and chunk limits pass.

If the checkpoint state vector is not yet contained, the guest remains in
`receiving-project`. If it is contained but the document hash or manifest does
not match because newer content operations have already arrived, the guest
waits for the creator's next sealed generation. This rolling-seal race is not
`invalid-project`.

After the checkpoint vector is contained, an asset that is present with the
wrong byte length or SHA-256 is an integrity failure. A missing manifest asset,
or a document/manifest mismatch that never receives a newer matching seal,
becomes `stalled-project` after the inactivity window. Structural violations
and hard-limit violations become `invalid-project` immediately.

`md5ext` remains the Y.Map lookup key; SHA-256 is the authoritative byte
integrity check. This design does not claim to authenticate the legacy MD5
filename.

The first successful materialization creates a new record with:

- a new `localProjectId`
- `revision: 0`
- no `driveFileId`
- the received title or a collaboration fallback title
- `saveState: "clean"`

Subsequent valid remote updates update this new record with revision CAS before
loading the new state into the VM. Invalid remote updates leave the last valid
VM state and local revision unchanged.

## 7. Host preflight

Create room is rejected unless the room creator's current project passes:

- ProjectDocument schema and safe-key validation
- all costume and sound references resolve to runtime asset bytes
- each reference's `contentSha256` matches the actual bytes
- each manifest byte length matches the actual bytes
- distinct asset count, per-asset bytes, total asset bytes, and canonical
  document bytes are within the existing collaboration limits

The failure UI reports a count and stable issue codes, for example:

> 共同編集を開始できません。素材2件を復旧してください。

Technical paths and hashes are available only in diagnostic details. Room
creation does not partially connect after preflight failure.

## 8. Progress, stall detection, and limits

During bootstrap the UI shows:

- current phase
- verified asset count, for example `素材 4/7`
- received bytes when known

`stalled-project` is entered when either:

- no bootstrap, peer, byte, manifest, or verified-asset progress occurs for
  15 seconds; or
- the bootstrap sealer disconnects while the latest sealed checkpoint remains
  incomplete.

Stall detection does not discard staging state. Available actions are:

- `再接続`: reconnect to the same configured signaling URL and room
- `退出`: discard staging state and keep the previous local project
- `診断情報`: copy issue codes, phase, counts, and limits without secrets,
  OAuth data, asset bytes, or the invite fragment

Hard limits:

- canonical ProjectDocument: 5 MiB
- asset count: 200
- total asset bytes: 5 MiB
- one asset: 5 MiB
- one decoded Yjs update accepted into staging: 16 MiB
- one reassembled framed wire message: existing 4,096 chunks and approximately
  32 MiB encoded ceiling

An exceeded hard limit enters `invalid-project`; it is not retryable without a
new or smaller host state.

`invalid-project` is terminal for the current session. Reconnecting starts a
fresh staging Y.Doc and bootstrap. `stalled-project` retains staging state;
`再接続` returns it to `receiving-project` and resumes progress tracking.

## 9. Local-save failure and SB3 rescue

If validation succeeds but initial IndexedDB record creation fails, the guest
enters `local-save-failed`. The validated materialization remains in memory and
the previous project remains loaded.

The UI offers:

1. `保存を再試行`: retry atomic record creation from the retained
   materialization without downloading it again.
2. `SB3をダウンロード`: export directly from the retained validated document
   and assets.
3. `退出`: discard staging and retained materialization.

VM editing is not enabled until local record creation and VM load both succeed.

## 10. Drive writer rule

Room creation and Join require only a valid invite/signaling configuration.
Google and Drive are optional.

The creator is locally `ready` immediately after host preflight and the initial
sealed transaction succeed. Drive uses two local, non-transferable predicates.

An explicit first backup or explicit replacement save is allowed when:

```text
createdThisRoom
&& driveConnected
&& bootstrapState == ready
```

Background autosave is allowed when:

```text
createdThisRoom
&& driveConnected
&& currentProject.driveFileId
&& bootstrapState == ready
```

The room creator may therefore choose `Driveにもバックアップ` before a file
id exists. The first predicate permits that explicit operation only on the
room-creating device. After it succeeds and persists a file id, the second
predicate permits autosave.

When the creator disconnects Google, leaves, or loses the Drive file link,
Drive backup stops. Collaboration and per-device local persistence continue.
Guests cannot become Drive writers by:

- sorting first by participant id
- sending `eligible: true`
- writing a `host` field to awareness or Yjs
- copying an old invite containing a Drive file id

Existing leader election may remain temporarily for compatibility and
diagnostics, but it is not consulted by the stage-1 Drive authorization gate.
Leader/Follower text is removed from the user-facing status.

## 11. Invite compatibility

New invite:

```ts
interface CollabInvite {
  roomId: string;
  secret: string;
}
```

The decoder accepts the prior shape with `driveFileId`, strips the file id from
the returned collaboration capability, and never opens Drive during Join.
Signaling topic derivation remains based only on `roomId` and `secret`, so old
and new invites retain the existing privacy property.

## 12. Error handling

| Condition | Result |
|---|---|
| Invalid invite or missing signaling URL | Stop before connection; current project unchanged |
| Host preflight failure | Do not create room; show repair-oriented summary |
| Assets still arriving before seal | Continue receiving with progress |
| Checkpoint state vector not yet contained | Continue receiving |
| Newer content races an older seal | Wait for the next creator seal |
| Sealed checkpoint missing bytes or never matching a newer seal | Wait, then stalled after inactivity |
| Present asset has wrong length or SHA | `invalid-project`; never update VM/IndexedDB |
| Schema, safe-key, update, or hard-limit failure | `invalid-project`; never update VM/IndexedDB |
| Creator leaves during incomplete bootstrap | `stalled-project`; offer reconnect/leave/diagnostics |
| Initial IndexedDB write fails | `local-save-failed`; retry/SB3/leave |
| Invalid update after ready | Keep last valid VM and local revision; show collaboration issue |
| Room creator leaves after guests are ready | P2P/local editing continues; Drive backup stops |

## 13. Required acceptance tests

1. A host without Google or Drive can create a room and a new invite contains
   no Drive file id.
2. A guest without Google joins without Picker, receives all targets/assets,
   and gets a new local project id with no Drive file id.
3. The guest's previously open project and Drive link remain unchanged until
   validated local-copy creation succeeds.
4. Guest edits before `ready` are not sent to the shared Y.Doc.
5. A host project with a missing, hash-mismatched, oversized, or invalid asset
   is rejected before room creation.
6. A sealed checkpoint with a missing manifest asset never reaches `ready`.
7. A host edit during guest bootstrap results in a later sealed generation and
   one consistent ready state.
8. Host departure during asset transfer preserves the guest's existing project
   and produces `stalled-project`.
9. Duplicate, reordered, missing, or over-limit chunks never change VM or
   IndexedDB state.
10. Initial IndexedDB failure supports retry and direct SB3 export without
    another network transfer.
11. Guest-provided `host` or `eligible` claims cannot enable Drive writes.
12. After `ready`, an invalid remote update preserves the last valid VM state
    and local revision.
13. The room creator can enable Drive backup after room creation; guests
    remain unable to write Drive while in the room.
14. An old invite joins without opening or inheriting its Drive file.
15. Existing sprite-addition, large-frame, backpressure, local-save, typecheck,
    production-build, and two-browser collaboration tests remain green.
16. A guest remains receiving until its staging state vector contains the
    sealed checkpoint vector.
17. A newer content update racing an older seal waits for a later seal instead
    of entering `invalid-project`.
18. Explicit first Drive backup works without a file id, while background
    autosave remains blocked until the creator has a persisted file id.

## 14. Existing surfaces that must change

- `packages/collab-invite`: make new invite creation Drive-free and accept both
  old and new decode shapes.
- `apps/editor-web/src/collab-session.ts`: split Create/Join readiness, own the
  staging/bootstrap state machine, and stop using peer eligibility as a Drive
  authorization decision.
- `packages/collaboration-domain`: add bootstrap metadata, state-vector
  containment, complete asset/hash validation, and host preflight.
- `apps/editor-web/src/main.ts`: remove pre-room Drive save and Join Picker,
  preserve the guest's current record, wire bootstrap actions, and apply the
  creator-only Drive predicates.
- editor-web HTML/CSS/E2E: expose progress, stalled, retry, diagnostics, and SB3
  rescue while removing Leader/Follower copy.

## 15. Delivery stages after this design

This design is stage 1:

1. Drive-independent Create/Join
2. In-band sealed bootstrap checkpoint
3. Staging validation and atomic guest local copy
4. Creator-only optional Drive backup
5. Bootstrap progress, stall, retry, diagnostics, and SB3 rescue
6. Leader/Follower copy removal

Separate designs and plans follow for:

- **Stage 2:** corrupt local-record detection and automatic recovery copy
- **Stage 3:** one primary local-save status with Collab and Drive backup as
  secondary details

