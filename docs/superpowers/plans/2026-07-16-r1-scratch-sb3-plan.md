# R1 Scratch Editor + Safe SB3 I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant-scoped content-addressed assets, V1-hash-stable envelopes, hard-reject SB3 import/export with isolated spool/workers, pinned SVG/display policy, closed lease/GC lifecycle, and a narrow Scratch host **after** Task 0 spike Go — no silent stubs, no `acceptWarnings`.

**Architecture:** Design `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md` (revision post-`d64adee`). Storage **A** + Editor **E1** + I/O **S1** with org grants, head-only project-scoped asset URLs, import-only atomic TX, and schemaVersion-dispatched canonicalize.

**Tech Stack:** TypeScript, pnpm, Vitest, Playwright (host), better-sqlite3, Hono, vendor Scratch `v14.1.0` / `7c172e…`, `@xmldom/xmldom`, `css-tree@3.2.1`.

## Global Constraints

- **Do not implement until revised design is approved**
- Product path must never call Gate 0 stub export
- Never embed asset bytes in envelope JSON
- Equivalence ≠ ZIP hash
- Unknown elements → **hard reject only** (see Design §6.4)
- Do not break V1 `contentHash` for existing documents
- Import must use `importSb3CreateProjectAtomic` — **never** nested `createProject` inside another TX
- Asset GET is **head-only**; no snapshot query param
- UTF-8-safe tooling for docs

## File map

| Path | Responsibility |
|---|---|
| `packages/project-schema` | §6.4 fields, `CostumeRef`/`SoundRef`, schemaVersion 2, validators |
| `packages/project-envelope` | **Frozen V1** canonicalize; V2 includes §6.4 preserve fields |
| `packages/project-assets-fs` | Bytes put/get/quarantine; §4.5 path safety |
| `packages/project-store-sqlite` | Tables + CHECK/FK; grants; **leases**; `importSb3CreateProjectAtomic` |
| `packages/sb3-tools` | Spool+worker; §6.4 canonical I/O; §7 SVG safety |
| `packages/project-service` | save/restore grant verify; import delegates to atomic repo |
| `apps/r1-persist-server` | Routes; GC; §4.3 headers; quotas |
| `apps/r1-scratch-host` | After Task 0 Go; §7.3 display path |
| `docs/r1/SCRATCH_SB3*.md` | Runbook + Go |

---

### Task 0: Scratch integration spike (Go / Stop)

**Files:**

- `apps/r1-scratch-host/spike/**`
- `apps/r1-scratch-host/spike/schema/document-spike-v0.ts` — provisional types mirroring Design §6.1 + §6.4 preserve fields
- `apps/r1-scratch-host/spike/fixtures/cat-with-sound.expected.json` — golden expected document
- `docs/r1/SCRATCH_SPIKE.md`

**Go criteria (all required):**

1. Vendor pin embeds **workspace + stage** without patching submodule
2. Real costumes/sounds **display and run** via §7.3 (`fetch` octet-stream → `storage.createAsset`; **no** `<img src>` to asset URL for SVG)
3. Capture block **create / delete / connect / field edit**
4. Rebuild provisional document from VM; **`equivalenceSpikeV0`** matches fixture on Design §6.4 **保持** set (targets, blocks, variables, lists, broadcasts, extensions, sprite/stage pose, costumes/sounds refs by `contentSha256` + metadata)

**Stop:** Any criterion needs vendor patch → stop host work; open ADR/fork decision; server Tasks 1–9 may continue.

- [ ] **Step 1:** Spike app + provisional schema + fixture from vendor SB3 sample
- [ ] **Step 2:** Implement `equivalenceSpikeV0` + display-path proof (SVG + PNG)
- [ ] **Step 3:** Record Go or Stop in `docs/r1/SCRATCH_SPIKE.md`
- [ ] **Step 4: Commit** `docs(r1): Scratch host spike Go/Stop evidence`

---

### Task 1: Schema — §6.4 fields + CostumeRef / SoundRef + V1 untouched

**Files:** `packages/project-schema/**`

Implement Design §6.1–§6.4:

- Extend `ScratchTarget` with **保持** fields: `currentCostume`, `costumes[]`, `sounds[]`, `volume`, `layerOrder`; stage: `tempo`, `videoState`, `videoTransparency`, `textToSpeechLanguage`; sprite: `visible`, `x`, `y`, `size`, `direction`, `draggable`, `rotationStyle`
- `CostumeRef` / `SoundRef` discriminated unions; `dataFormat` unions exactly: costume `svg|png|jpg|bmp|gif`; sound `wav|mp3`
- Canonical alias rules: accept `jpeg` on import path in sb3-tools; schema stores **`jpg`**
- Validators reject §6.4 **明示拒否** keys if present on round-trip test objects
- `currentCostume`: `costumes.length >= 1` for schemaVersion ≥ 2 durable; `0 <= currentCostume < length`
- **Allow** duplicate `md5ext` across costumes
- Keep schemaVersion **1** documents valid (no new fields required)
- **Policy:** new empty projects stay schemaVersion 1; SB3 import mints schemaVersion 2 (Design §5.3)

- [ ] **Step 1: Failing tests** — fixture covering stage + sprite preserve fields; reject comments/monitors keys
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(project-schema): schemaVersion 2 Scratch field pin and asset refs`

---

### Task 2: Envelope — freeze V1 hash; dispatch by schemaVersion

**Files:** `packages/project-envelope/**`

- V1 canonicalize/contentHash **byte-stable** vs existing golden fixtures
- V2 `canonicalizeTarget` includes all §6.4 **保持** target fields + costume/sound refs in stable key order
- **No** separate `{document, assetSha256s}` wrapper hash
- Tests: V1 golden hashes unchanged; V2 changes when asset meta or sprite `x`/`y` changes

- [ ] **Step 1: Capture/lock V1 golden hashes from current fixtures**
- [ ] **Step 2: Implement dispatcher**
- [ ] **Step 3: PASS; commit** `feat(project-envelope): schemaVersion-dispatched canonicalize`

---

### Task 3: V1 persistence regression (read/save/snapshot/restore)

**Files:** extend `project-store-sqlite` / `r1-persist-server` / `project-service` tests

- Existing V1 projects: save, idempotent replay, snapshot, restore, reopen DB — hashes and ACL unchanged

- [ ] **Step 1–3; commit** `test(r1): freeze V1 envelope hash persistence regression`

---

### Task 4: `project-assets-fs` + quarantine + path safety

**Files:** new package

- `putIfAbsent`, `get`, `quarantine(sha)`, grace metadata
- Atomic write; digest mismatch on existing sha → throw
- §4.5: 64-hex validation; resolved path containment; **tests** for symlink/reparse point escape attempts

- [ ] **Step 1: Failing tests** — bad sha, symlink escape, mismatch digest
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(project-assets-fs): content-addressed bytes with quarantine`

---

### Task 5: SQLite assets — objects, grants, leases, CHECK/FK

**Files:** `project-store-sqlite` `migrate-assets.ts`, repository API

Design §4.1 tables including CHECK constraints and `organizations` FK.

```typescript
ensureAssetObject({ sha256, byteLength, md5Hex, dataFormat }): void
grantOrganizationAsset(organizationId, sha256): void
createImportLeases(organizationId, importSessionId, shas: string[], ttlMs): void
releaseImportLeases(importSessionId): void
verifyOrganizationAssetRefs(organizationId, refs, readFile): void

// Import-only — single db.transaction(); MUST NOT call nested withTransaction.
importSb3CreateProjectAtomic(input: ImportSb3AtomicInput): ProjectHead
```

- [ ] **Step 1: Contract tests** — CHECK rejects bad hex; cross-org grant missing fails; concurrent grants; atomic import rollback leaves no project/grants/objects
- [ ] **Step 2: Implement migration + repo**
- [ ] **Step 3: PASS; commit** `feat(project-store): asset objects grants leases and atomic import`

---

### Task 6: project-service asset verification + import wiring

**Files:** `packages/project-service/**`

- On save/restore: `verifyOrganizationAssetRefs` for all refs
- Import path: FS put outside TX → `importSb3CreateProjectAtomic` ( **not** `createProject`)
- Unknown sha / wrong org / meta skew → typed error

- [ ] **Step 1: Failing unit tests** — import rollback; save without grant
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(project-service): org asset verify and atomic import`

---

### Task 7: sb3-tools — spool, worker, §6.4 canonical I/O, §7 SVG

**Files:** `packages/sb3-tools/**`

- Gate stub export away from product
- Worker: ZIP from temp path; §6.4 field mapping (preserve/normalize/reject); canonical `dataFormat`; reject comments/monitors/unknown keys
- Media limits §6.3: raster dimensions, SVG node count, audio duration, rate/sampleCount verification
- SVG safety §7.1: `@xmldom/xmldom` DOM walk + `css-tree@3.2.1`; **no regex-only gate**
- Export: emit §6.4 preserve fields; canonical extensions on `md5ext`
- Manifest JSON over IPC; parent deletes temps; timeout kill tests

- [ ] **Step 1: Failing tests** — field reject list, jpeg→jpg, unsafe SVG, rate mismatch, round-trip equivalence helper
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(sb3-tools): canonical SB3 import export with media limits`

---

### Task 8: HTTP import / export / head-only asset GET

**Files:** `apps/r1-persist-server/**`

- Multipart streams to capped temp before worker
- `POST /v1/projects/import-sb3`:
  1. worker manifest
  2. createImportLeases
  3. FS putIfAbsent (check org + global quota §4.6)
  4. `importSb3CreateProjectAtomic` + release leases in same TX
  5. rollback on any failure — no project/grant/object rows
- `GET /v1/projects/:id/export-sb3`
- `GET /v1/projects/:projectId/assets/:sha256`:
  - head document ref check only
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment`
  - `X-Content-Type-Options: nosniff`
- CSRF/Origin on mutating import

Acceptance extras:

- Import fail → no grant/project/object rows; FS orphan bytes only
- Crash between FS write and DB commit → lease TTL → GC-eligible orphan
- Concurrent same sha two orgs / same org
- Cross-org sha forge on save/GET
- Quota reject when org or global cap exceeded

- [ ] **Step 1: Failing HTTP tests**
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): SB3 routes head-only assets quotas`

---

### Task 9: GC — revision + snapshot + lease reference set, fail-closed quarantine

**Files:** bootstrap GC in persist server + store helpers

Design §9:

- Reference set = **all revisions** + **all snapshots** + **active leases** (`expires_at > now`)
- **Exclude** grants from reference set
- After unreferenced confirmed: quarantine → 7-day grace → delete; revoke grants + `asset_objects` row
- Any scan/parse/schema error → **abort entire GC**
- Tests: corrupt revision aborts; in-flight lease protects; expired lease does not; grant removed when unreferenced

- [ ] **Step 1: Tests**
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): fail-closed asset GC with lease and quarantine`

---

### Task 10: Narrow Scratch host (only if Task 0 = Go)

**Files:** `apps/r1-scratch-host/**`

- Promote spike schema → production `ProjectDocument` mapping (Task 1 types)
- Import/open/export via server APIs
- Display assets per §7.3 (storage boundary)
- Autosave with CSRF
- **Required tests:** block add + connect + delete + field edit; green flag; reload preserves §6.4 fields; export equivalence

If Task 0 = Stop: skip; document Stop in GO_NO_GO.

- [ ] **Step 1–3; commit** `feat(r1-scratch-host): narrow editor after spike Go`

---

### Task 11: Docs + scripts + final gates

- `docs/r1/SCRATCH_SB3.md`, `SCRATCH_SB3_GO_NO_GO.md`
- `pnpm r1:scratch:test`
- CI paths

```text
pnpm build
pnpm gate0:test
pnpm r1:persist:test
pnpm r1:auth:test
pnpm r1:scratch:test
```

- [ ] **Commit** `docs(r1): Scratch SB3 runbook and Go`

---

## Spec coverage self-check

| Requirement | Task |
|---|---|
| §6.4 Scratch field classification | 0 (provisional), 1, 2, 7 |
| Org grants + meta verify | 5, 6, 8 |
| Head-only project-scoped asset URL + octet-stream | 8, 10 |
| Import atomic TX + import-only repo | 5, 6, 8 |
| Lease table + GC without grant pinning | 5, 9 |
| V1 hash frozen | 2, 3 |
| dataFormat canonical + media limits | 1, 4, 7 |
| SVG §7 pinned parser + display path | 0, 7, 8, 10 |
| rate/sampleCount verification | 7 |
| contentSha256 path safety | 4 |
| Org + global quotas | 8 |
| Spool/worker/IPC/temp cleanup | 7, 8 |
| Task 0 provisional fixture/schema | 0 |
| Hard reject only | 1, 7, 8 |
| Host block graph + green flag | 0, 10 |
| Crash/concurrent/forgery acceptance | 8, 9 |

## Execution gate

**Do not implement until revised design is approved.**
