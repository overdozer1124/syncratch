# R1 Scratch Editor + Safe SB3 I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant-scoped content-addressed assets, V1-hash-stable envelopes, hard-reject SB3 import/export with isolated spool/workers, SVG/media Go bars, and a narrow Scratch host **after** Task 0 spike Go — no silent stubs, no `acceptWarnings`.

**Architecture:** Design `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md` (revised). Storage **A** + Editor **E1** + I/O **S1** with org grants, project-scoped asset URLs, and schemaVersion-dispatched canonicalize.

**Tech Stack:** TypeScript, pnpm, Vitest, Playwright (host), better-sqlite3, Hono, vendor Scratch `v14.1.0` / `7c172e…`.

## Global Constraints

- **Do not implement until revised design is approved**
- Product path must never call Gate 0 stub export
- Never embed asset bytes in envelope JSON
- Equivalence ≠ ZIP hash
- Unknown elements → **hard reject only**
- Do not break V1 `contentHash` for existing documents
- UTF-8-safe tooling for docs

## File map

| Path | Responsibility |
|---|---|
| `packages/project-schema` | `CostumeRef` / `SoundRef`, schemaVersion 2, validators, format allow-list |
| `packages/project-envelope` | **Frozen V1** canonicalize; V2 document fields via same dispatcher |
| `packages/project-assets-fs` | Bytes put/get/quarantine |
| `packages/project-store-sqlite` | `asset_objects`, `organization_asset_grants`, verify helpers |
| `packages/sb3-tools` | Spool+worker import/export; SVG safety worker; no product stubs |
| `packages/project-service` | save/restore full grant+meta verify |
| `apps/r1-persist-server` | Routes; GC fail-closed; headers nosniff |
| `apps/r1-scratch-host` | After Task 0 Go |
| `docs/r1/SCRATCH_SB3*.md` | Runbook + Go |

---

### Task 0: Scratch integration spike (Go / Stop)

**Files (throwaway or keep):** `apps/r1-scratch-host/spike/**` or ADR note under `docs/r1/`

**Go criteria (all required):**

1. Vendor pin embeds **workspace + stage** without patching submodule
2. Real costumes/sounds **display and run**
3. Capture block **create / delete / connect / field edit**
4. Rebuild `ProjectDocument` from VM/workspace **without dropping assets**

**Stop:** Any criterion needs vendor patch → stop host work; open ADR/fork decision; server Tasks 1–8 may continue.

- [ ] **Step 1: Spike branch / app**

- [ ] **Step 2: Record Go or Stop in `docs/r1/SCRATCH_SPIKE.md`**

- [ ] **Step 3: Commit** `docs(r1): Scratch host spike Go/Stop evidence`

---

### Task 1: Schema — CostumeRef / SoundRef + V1 untouched

**Files:** `packages/project-schema/**`

- Add discriminated refs; pin `dataFormat` unions from Scratch **v14.1.0** allow-list tables (document source paths in test comments)
- `currentCostume`: require `costumes.length >= 1` on validate for schemaVersion ≥ 2; `0 <= currentCostume < length`
- **Allow** duplicate `md5ext` across costumes
- Keep schemaVersion **1** documents valid as today (no costumes fields)

- [ ] **Step 1: Failing tests**

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(project-schema): CostumeRef and SoundRef for schemaVersion 2`

---

### Task 2: Envelope — freeze V1 hash; dispatch by schemaVersion

**Files:** `packages/project-envelope/**`

- V1 canonicalize/contentHash **byte-stable** vs existing golden fixtures
- V2 includes costume/sound fields in target canonicalize (stable key order)
- **No** separate `{document, assetSha256s}` wrapper hash
- Tests: V1 golden hashes unchanged; V2 changes when asset meta changes

- [ ] **Step 1: Capture/lock V1 golden hashes from current fixtures**

- [ ] **Step 2: Implement dispatcher**

- [ ] **Step 3: PASS; commit** `feat(project-envelope): schemaVersion-dispatched canonicalize`

---

### Task 3: V1 persistence regression (read/save/snapshot/restore)

**Files:** extend `project-store-sqlite` / `r1-persist-server` / `project-service` tests

- Existing V1 projects: save, idempotent replay, snapshot, restore, reopen DB — hashes and ACL unchanged

- [ ] **Step 1–3; commit** `test(r1): freeze V1 envelope hash persistence regression`

---

### Task 4: `project-assets-fs` + quarantine helper

**Files:** new package

- `putIfAbsent`, `get`, `quarantine(sha)`, grace metadata optional
- Atomic write; mismatch on existing sha → throw

- [ ] **Step 1–3; commit** `feat(project-assets-fs): content-addressed bytes with quarantine`

---

### Task 5: SQLite `asset_objects` + `organization_asset_grants`

**Files:** `project-store-sqlite` migrate-auth-style `migrate-assets.ts`, repository API

```typescript
ensureAssetObject({ sha256, byteLength, md5Hex, dataFormat }): void
grantOrganizationAsset(organizationId, sha256): void
verifyOrganizationAssetRefs(organizationId, refs: Array<CostumeRef|SoundRef>, readFile: …): void
// checks grant + sha file digest + md5 + format + md5ext + byte_length
```

- [ ] **Step 1: Contract tests** — cross-org grant missing fails; meta mismatch fails; concurrent grants

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(auth-store): organization asset grants and object metadata`

---

### Task 6: project-service asset verification (before HTTP)

**Files:** `packages/project-service/**`

- On save/restore: call `verifyOrganizationAssetRefs` for all refs (inject port)
- Unknown sha / wrong org / meta skew → typed error → 4xx later

- [ ] **Step 1: Failing unit tests**

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(project-service): require org asset grant and meta match on save`

---

### Task 7: sb3-tools — spool, worker, SVG safety, canonical I/O

**Files:** `packages/sb3-tools/**`

- Rename/gate stub export away from product
- Worker: `--max-old-space-size`, wall timeout, SIGKILL; parse ZIP from **temp path**; write verified files under worker temp; return **manifest JSON** (paths + sha + md5 + format + byteLength) via stdout/IPC file — **not** full asset Map
- Parent: open manifest paths, `putIfAbsent`, delete temps
- SVG safety scan in worker; fail import on dangerous constructs
- Export worker/assembler: max output bytes/time/memory; cleanup tests

Format allow-list: **exact** v14.1.0 set from Task 1.

- [ ] **Step 1: Failing tests** — limits, traversal, unsafe SVG, timeout kills + temp deleted, round-trip equivalence

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(sb3-tools): isolated spool import/export without stubs`

---

### Task 8: HTTP import / export / project-scoped asset GET

**Files:** `apps/r1-persist-server/**`

- Multipart **streams to capped temp** before worker
- `POST /v1/projects/import-sb3` — TX: assets + grants + createProject; rollback semantics tested
- `GET /v1/projects/:id/export-sb3`
- `GET /v1/projects/:projectId/assets/:sha256` — ACL + ref check; `nosniff`; safe Content-Type/Disposition (**not** free same-origin active SVG browse)
- CSRF/Origin on mutating import

Acceptance extras:

- Import fail → no grant/project
- Crash between byte write and DB commit → restart policy (no cross-org leak; quarantine orphans)
- Concurrent same sha two orgs
- Cross-org sha forge on save/GET
- GC interaction deferred to Task 9 but hooks reserved

- [ ] **Step 1: Failing HTTP tests**

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): SB3 routes and project-scoped assets`

---

### Task 9: GC — full reference set, fail-closed, quarantine

**Files:** bootstrap GC in persist server + store helpers

Referenced = **all revisions** + **all snapshots** + **in-flight protection** + **all grants**.

Any scan/parse/schema error → **abort GC**. Deletes go to quarantine + grace; never eager wipe on partial failure.

- [ ] **Step 1: Tests** — corrupt revision aborts; unreferenced quarantined; in-flight protected

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): fail-closed asset GC with quarantine`

---

### Task 10: Narrow Scratch host (only if Task 0 = Go)

**Files:** `apps/r1-scratch-host/**`

- Import/open/export via server APIs
- Display real assets under safe delivery rules
- Autosave with CSRF
- **Required tests:** block add + connect + delete + field edit; **green flag** run; reload; export equivalence

If Task 0 = Stop: skip this task; document Stop in GO_NO_GO (server-only Technical Go possible only if design re-approved — default is host required for full slice Go).

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
| Org grants + meta verify | 5, 6, 8 |
| Project-scoped asset URL | 8 |
| V1 hash frozen | 2, 3 |
| CostumeRef/SoundRef; currentCostume; dup md5ext OK | 1 |
| Fixed v14.1.0 format allow-list | 1, 7 |
| SVG/media isolation Go bars | 7, 8 |
| Spool/worker/IPC/temp cleanup | 7, 8 |
| GC full set + quarantine | 9 |
| Task 0 spike | 0 |
| Hard reject only | 7, 8 |
| Host block graph + green flag | 0, 10 |
| Crash/concurrent/forgery acceptance | 8, 9 |

## Execution gate

**Do not implement until revised design is approved.**
