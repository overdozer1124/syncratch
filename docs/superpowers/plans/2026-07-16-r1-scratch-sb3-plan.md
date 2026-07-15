# R1 Scratch Editor + Safe SB3 I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant-scoped content-addressed assets, V1-hash-stable envelopes, hard-reject SB3 import/export with isolated spool/workers, pinned SVG/display policy, closed GC/quota races, and a narrow Scratch host **after** Task 0 spike Go — no silent stubs, no `acceptWarnings`.

**Architecture:** Design `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md` (revision post-`3d228cd`). Storage **A** + Editor **E1** + I/O **S1**.

**Tech Stack:** TypeScript, pnpm, Vitest, Playwright (host), better-sqlite3, Hono, vendor Scratch `v14.1.0` / `7c172e…`, **`@xmldom/xmldom@0.8.10`**, `css-tree@3.2.1`.

## Global Constraints

- **Do not implement until revised design is approved**
- Product path must never call Gate 0 stub export
- Never embed asset bytes in envelope JSON
- Equivalence ≠ ZIP hash; use §6.7 pairing for export→re-import
- **Accept** empty `comments: {}` and `monitors: []`; **reject** non-empty
- **Reject** block `comment` field
- **Preserve** block `mutation` (custom procedures)
- Import: `importSb3CreateProjectAtomic` only — no nested `createProject`
- Asset GET: head-only; reject `gc_state != 'live'`
- UTF-8-safe tooling for docs

## File map

| Path | Responsibility |
|---|---|
| `packages/project-schema` | §6.4–§6.6 fields, `mutation`, validators |
| `packages/project-envelope` | V1 frozen; V2 canonicalize mutation + pose + assets |
| `packages/project-assets-fs` | put/get/quarantine; §4.5 lstat/realpath/no-follow |
| `packages/project-store-sqlite` | objects+grants+leases+**reservations**+`gc_state`+atomic import |
| `packages/sb3-tools` | canonical I/O; `equivalenceProduction`; SVG §7; audio corpus |
| `packages/project-service` | verify live assets; atomic import |
| `apps/r1-persist-server` | routes; GC §9.4; reconcile §9.7; quotas §4.6 |
| `apps/r1-scratch-host` | after Task 0 Go |
| `docs/r1/SCRATCH_SB3*.md` | runbook + Go |

---

### Task 0: Scratch integration spike (Go / Stop)

**Files:**

- `apps/r1-scratch-host/spike/**`
- `apps/r1-scratch-host/spike/schema/document-spike-v0.ts` — include `mutation` on blocks
- `apps/r1-scratch-host/spike/fixtures/cat-with-sound.expected.json`
- `apps/r1-scratch-host/spike/fixtures/custom-procedure.expected.json`
- `docs/r1/SCRATCH_SPIKE.md`

**Go criteria (all required):**

1. Vendor pin embeds workspace + stage without submodule patch
2. Real costumes/sounds via §7.3 (`fetch` → `storage.createAsset`; no SVG `<img src>`)
3. Block create / delete / connect / field edit
4. **`equivalenceSpikeV0`** (§6.7 pairing) matches fixtures including **custom procedure mutation**
5. Empty `comments`/`monitors` from vendor SB3 import path accepted in spike converter

- [ ] **Step 1:** Spike app + fixtures (cat + custom procedure)
- [ ] **Step 2:** `equivalenceSpikeV0` + display-path proof
- [ ] **Step 3:** Record Go/Stop in `docs/r1/SCRATCH_SPIKE.md`
- [ ] **Step 4: Commit** `docs(r1): Scratch host spike Go/Stop evidence`

---

### Task 1: Schema — §6.4–§6.6 + mutation + empty comments/monitors

**Files:** `packages/project-schema/**`

- `ScratchBlock.mutation?: Record<string, unknown>`
- Target fields per §6.4 (pose, costumes, sounds, …)
- `CostumeRef` / `SoundRef`; dataFormat unions per §6.2
- Validators:
  - Accept/normalize `comments: {}`, `monitors: []`
  - Reject non-empty comments/monitors, block `comment`
  - Reject unknown keys; enforce §6.6 opcode/extension allow-list
  - Reject duplicate sprite names (import validation helper)
- schemaVersion 1 unchanged; SB3 import → schemaVersion 2

- [ ] **Step 1: Failing tests** — origin-style empty comments/monitors OK; non-empty rejected; mutation present on procedure blocks
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(project-schema): Scratch field pin mutation and comment policy`

---

### Task 2: Envelope — freeze V1 hash; V2 includes mutation

**Files:** `packages/project-envelope/**`

- V1 byte-stable
- V2 `canonicalizeBlock` includes `mutation` (stable key order) + §6.4 target fields
- Tests: V1 unchanged; V2 hash changes when mutation changes

- [ ] **Step 1–3; commit** `feat(project-envelope): schemaVersion-dispatched canonicalize with mutation`

---

### Task 3: V1 persistence regression

- [ ] **Step 1–3; commit** `test(r1): freeze V1 envelope hash persistence regression`

---

### Task 4: `project-assets-fs` + quarantine + §4.5 path safety

- `putIfAbsent`, `get`, `quarantine`, startup root validation
- lstat/realpath/no-follow; symlink/reparse tests (POSIX + Windows notes)
- Reject read/write when `gc_state != 'live'` (caller passes state from store)

- [ ] **Step 1–3; commit** `feat(project-assets-fs): safe paths and quarantine helpers`

---

### Task 5: SQLite — objects, grants, leases, reservations, gc_state

**Files:** `project-store-sqlite/migrate-assets.ts`

Design §4.1 CHECK (`NOT GLOB '*[^0-9a-f]*'`), `gc_state`, quota reservation tables.

```typescript
createImportLeases(...): void
createQuotaReservation(orgId, sessionId, shas: Array<{sha256, byteLength}>): void
releaseImportSession(sessionId): void // leases + reservation
assertOrgQuotaHeadroom(orgId, additionalShas): void // distinct union, IMMEDIATE
importSb3CreateProjectAtomic(...): ProjectHead
getAssetGcState(sha256): 'live' | 'quarantining' | 'quarantined'
markQuarantining(sha256): void // used by GC TX
```

- [ ] **Step 1: Contract tests** — bad hex CHECK; atomic import rollback; reservation enforces distinct-sha quota
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(project-store): assets leases reservations gc_state`

---

### Task 6: project-service — verify live assets + atomic import

- save/restore: reject quarantining/quarantined refs
- import: reservation → FS put → atomic TX
- [ ] **Step 1–3; commit** `feat(project-service): live asset verify and atomic import`

---

### Task 7: sb3-tools — canonical I/O, SVG, equivalenceProduction

**Files:** `packages/sb3-tools/**`

- Add dependency **`@xmldom/xmldom@0.8.10`**
- Import mapping §6.4–§6.5:
  - Normalize empty comments/monitors; reject non-empty + block comment
  - Preserve mutation; export always emits `comments:{}`, `monitors:[]`
- SVG §7.1: reject DOCTYPE/ENTITY/PI/`data:`/`@import`/external url
- Audio §6.3: WAV strict; MP3 uses fixture corpus — preserve `(rate,sampleCount)`, no frame±1 reject
- **`equivalenceProduction(docA, docB)`** — §6.7 target pairing + block graph normalization
- Golden tests:
  - `origin.sb3` class (empty comments/monitors) round-trip
  - `serialization_procedures.js` custom block fixture
  - Vendor WAV corpus sampleCount pairs

- [ ] **Step 1: Failing tests**
- [ ] **Step 2: Implement**
- [ ] **Step 3: PASS; commit** `feat(sb3-tools): canonical SB3 IO equivalence and SVG safety`

---

### Task 8: HTTP import / export / head-only asset GET

- Import flow §4.4 + quota reservation + global disk guard (spool/holding/temp §4.6.2)
- Reject asset GET/save when `gc_state != 'live'`
- CSRF/Origin on import

- [ ] **Step 1–3; commit** `feat(r1-persist-server): SB3 routes quotas and live asset GET`

---

### Task 9: GC — quarantining TX, grace, startup reconcile

Design §9.4–§9.7:

- GC candidate → `BEGIN IMMEDIATE` re-check → `quarantining` + grant delete → FS rename → `quarantined`
- Fail-closed full scan abort
- Tests: concurrent import during GC; quarantining ref rejected on save; reconcile after simulated crash
- Boot hook: `reconcileAssetGcState()`

- [ ] **Step 1–3; commit** `feat(r1-persist-server): GC quarantining state machine and reconcile`

---

### Task 10: Narrow Scratch host (if Task 0 = Go)

- Production mapping; §7.3 display; autosave; export equivalence via `equivalenceProduction`

- [ ] **Step 1–3; commit** `feat(r1-scratch-host): narrow editor after spike Go`

---

### Task 11: Docs + scripts + final gates

- [ ] **Commit** `docs(r1): Scratch SB3 runbook and Go`

---

## Spec coverage self-check

| Requirement | Task |
|---|---|
| Empty comments/monitors OK; non-empty reject | 1, 7 |
| Block mutation + §6.5 classification | 0, 1, 2, 7 |
| §6.6 extension allow-list | 1, 7 |
| §6.7 equivalenceProduction | 0, 7, 10 |
| GC quarantining + reconcile | 5, 9 |
| Quota distinct union + reservation | 5, 8 |
| `@xmldom/xmldom@0.8.10`; data: reject | 7 |
| Hex CHECK; lstat/realpath | 4, 5 |
| WAV/MP3 corpus semantics | 7 |
| Import atomic TX | 5, 6, 8 |
| SVG display path | 0, 10 |

## Execution gate

**Do not implement until revised design is approved.**
