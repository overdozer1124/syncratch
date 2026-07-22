# Block-Level Collaboration Phase 1 Design

**Status:** Implementation candidate (Cursor Phase 1)
**Date:** 2026-07-22
**Base:** `main` @ `c465514` (Phase 1 originally cut from `48b94c4`)
**Does not modify:** `2026-07-20-p2p-bootstrap-optional-drive-design.md`

## 1. Goal

同一スプライト上で、異なる block id / 異なる stack への同時編集を、
片方の全体 `blocksJson` snapshot で失わずに収束させる。

## 2. Background

PR #10 以降、target は `metadataJson` と `blocksJson` に分割され、座標などの
metadata 更新が block graph を上書きしない。しかし `blocksJson` は依然として
**スプライト全体の block map を1つの LWW 文字列**として持つ。

そのため、独立した2つの stack 追加でも、遅れて publish された古い全体
snapshot が相手の新規 block id を消し得る。

## 3. Decisions

1. Target 内の block graph を Yjs `blocks: Y.Map`（key = block id、value =
   その block の JSON 文字列）へ移す。block id 単位で独立に LWW 解決する。
2. `metadataJson` は従来どおり別キー。metadata 更新と block 更新は別競合領域。
3. 通常の共同編集 publish は、直前に受理した **shared baseline** との差分
   （upsert / delete）だけを1トランザクションで送る。VM の全 snapshot で
   shared `blocks` map を丸ごと置換しない。
4. **削除は baseline に存在した id がローカル操作で消えたときだけ**発行する。
   「今回のローカル snapshot に無い」だけでは未知の remote block を消さない。
5. Fresh room / 現行 writer は `blocks` map のみを書く。`blocksJson` は書かない。
6. Legacy `blocksJson`（± `metadataJson`）は **読取専用**。materialize 可能。
7. 同一 target に `blocks` map と `blocksJson` が同時に存在する場合は
   **fail-closed**（`MIXED_BLOCKS_REPRESENTATION`）。暗黙の二重 writer にしない。
8. Legacy だけを持つ target へ現行 peer が初めて書くとき、明示 upgrade:
   `blocks` map を書き、`blocksJson` を削除する（単一 writer への切替）。
9. materialize 後は既存の `assertSafeKeys` + `validateProject`
   （parent/next/input、topLevel、cycle、size/depth）で検証し、不正 remote は
   VM / IndexedDB へ適用しない。
10. 同一 block id または同一接続辺を双方が同時変更した競合は、Phase 1 では
    **意味的 merge を約束しない**。Yjs Map の決定的 LWW 勝者が両 peer で一致する。

## 4. Yjs layout

```text
targets/<targetId> : Y.Map
  id            : string
  metadataJson  : string   // ScratchTarget minus blocks
  blocks        : Y.Map    // blockId -> JSON.stringify(ScratchBlock | array entry)
  # legacy (read-only):
  blocksJson    : string   // whole block map JSON (must not coexist with blocks)
  json          : string   // pre-split whole target (unchanged read path)
```

## 5. Publish algorithm (editor session)

Shared baseline for target T = the last **VM-acknowledged** snapshot for T
(the session's `lastLocalTargetJson` after a successful shared apply / publish
ack). Do **not** use live `domain.getTarget(T)` at push time as the delete
baseline: a remote block may already be in the Y.Doc while VM apply is still
queued, and must not be treated as a local deletion.

On debounced publish for dirty target T with local snapshot L:

1. If T is absent from shared doc → full `writeTarget(L)` (new sprite path),
   including authoritative `blocks` replace.
2. Else compute:
   - metadata via 3-way merge `(baselineMeta, L.meta, sharedMeta)` and publish
     only when the merge differs from live shared metadata
   - `diffBlocks(baseline.blocks, L.blocks)`:
     - upsert id if local JSON ≠ baseline JSON (including adds)
     - delete id if id ∈ baseline ∧ id ∉ local
3. Apply metadata + block diff in one `LOCAL_ORIGIN` transaction
   (assets may share the same transaction via existing atomic helper).

Pending local rebase before VM apply uses **block-id 3-way merge** against
`(base, pending, remote)` so unrelated remote block adds are not wiped by a
pending whole-`blocks` field replace. If `base` is missing, blocks still merge
with an empty base (remote-only ids kept) and metadata overlays only keys that
already differ from remote.

## 6. Conflict / user-visible outcomes

| Case | Phase 1 result |
|------|----------------|
| Different block ids added | Both survive |
| One peer edits metadata, other edits blocks | Both survive |
| Baseline delete + peer add of other id | Delete and add both apply |
| Same block id concurrent field/opcode/link change | Deterministic Yjs LWW winner; loser edit discarded |
| Competing connect/disconnect on same edge | Same as same-block LWW (no op-CRDT) |

Future phases may introduce operation CRDTs / field-level editing. Phase 1
boundary stops at per-block-id LWW registers.

## 7. Non-goals

- Character / field-level co-editing inside one block
- Full operation CRDT that preserves conflicting connection intent
- Large rooms, central server persist, AI, public deploy
- Rewriting approved P2P/Drive bootstrap design

## 8. Acceptance tests (required)

1. Host/guest add different new stacks on same sprite → both stacks remain
2. Host connects existing stack into `forever` while guest edits another stack → both converge
3. Guest detaches one stack while host edits another block’s field → both converge
4. One peer moves sprite coords while other edits blocks → both remain
5. One deletes a baseline block while other adds an unknown block → new block not erased by stale snapshot
6. Same block concurrent change → identical deterministic result on both peers
7. Malformed / cyclic / dangling remote graph → not applied to VM/IDB; last good project + local UI kept
8. Existing sprite/asset, selection, viewport, tab regressions remain green
9. Prefer 2-browser E2E for same-sprite different-stack concurrent edit

## 9. Out of scope for connectivity score

`isWeakerBlockGraph` / connectivity scoring remains a **debounce heuristic only**.
It is not a consistency or “stronger snapshot wins” merge rule.
