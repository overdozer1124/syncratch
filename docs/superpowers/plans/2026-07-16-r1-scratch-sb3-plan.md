# R1 Scratch Editor + Safe SB3 I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-isolated SB3 import/export with **full costume/sound byte fidelity**, content-addressed asset store, schema+envelope updates, narrow Scratch host with autosave — without silent stubs and without requiring ZIP byte-identical round-trips.

**Architecture:** `ProjectDocument` holds structure + asset metadata; `AssetStore` holds SHA-256 bytes; `sb3-tools` binds/unbinds; `r1-persist-server` exposes import/export/asset routes; `r1-scratch-host` is a narrow editor shell. Design: `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md`.

**Tech Stack:** TypeScript, pnpm, Vitest, better-sqlite3, Hono, existing `@blocksync/sb3-tools` / `project-schema` / `project-service` / `project-autosave` / auth cookies. Vendor Scratch pin **unchanged**.

## Global Constraints

- **Do not implement until design is approved**
- Product export path **must not** call Gate 0 stub `exportSb3` that injects placeholder SVG
- Never embed asset bytes in envelope JSON
- Equivalence tests use canonical compare — **not** SHA-256 of SB3 ZIP
- Do not alter Gate 0 / R1 persistence / R1 auth Technical Go SHAs
- Prefer failing import over silent drop
- UTF-8-safe tooling only on docs

## File map (expected)

| Path | Responsibility |
|---|---|
| `packages/project-schema/src/index.ts` | `AssetRef`, costumes/sounds on targets, schemaVersion bump, validators for refs |
| `packages/project-envelope/src/` | Combined `contentHash(document + sorted asset sha set)` |
| `packages/project-assets-fs/src/` | New: FS `putIfAbsent` / `get` / `gcOrphans` |
| `packages/sb3-tools/src/` | `importToCanonical`, `exportFromCanonical`, retire stub from product; keep Gate0 fixtures isolated |
| `packages/project-service/src/` | Optional AssetStore hook on save (verify all sha present); create-from-import API helper |
| `apps/r1-persist-server/src/` | import-sb3 / export-sb3 / assets routes; limits; GC on boot |
| `apps/r1-scratch-host/` | Narrow Vite/React host: open, edit blocks, stage, autosave, import/export UX |
| `docs/r1/SCRATCH_SB3.md`, `SCRATCH_SB3_GO_NO_GO.md` | Runbook + Go verdict |

---

### Task 1: Schema — AssetRef + target costumes/sounds

**Files:**
- Modify: `packages/project-schema/src/index.ts`, `index.test.ts`
- Modify: fixtures in `project-envelope` / `sb3-tools` as needed to compile

```typescript
export interface AssetRef {
  name: string
  assetId: string
  md5ext: string
  dataFormat: string
  contentSha256: string
  rotationCenterX?: number
  rotationCenterY?: number
  bitmapResolution?: number
  rate?: number
  sampleCount?: number
}
```

Validation: every costume/sound has non-empty sha/md5ext; `currentCostume` in range; no duplicate md5ext per target unless Scratch allows (pin rule in tests).

- [ ] **Step 1: Failing tests** — document with costumes validates; missing `contentSha256` fails

- [ ] **Step 2: Implement schema bump**

- [ ] **Step 3: PASS; commit** `feat(project-schema): AssetRef costumes and sounds metadata`

---

### Task 2: Envelope hash includes asset set

**Files:**
- Modify: `packages/project-envelope/src/index.ts`, tests

`contentHash` input = canonicalize `{ document, assetSha256s: sorted unique }` derived from document (do not trust client-supplied separate list if it can diverge — **derive from document AssetRefs**).

- [ ] **Step 1: Failing test** — same doc different sha → different hash; adding unreferenced sha cannot quietly change hash if derived-only

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(project-envelope): contentHash includes asset sha set`

---

### Task 3: `@blocksync/project-assets-fs`

**Files:**
- Create: `packages/project-assets-fs/**`

```typescript
export function createFsAssetStore(rootDir: string): {
  putIfAbsent(sha256Hex: string, bytes: Uint8Array): void
  get(sha256Hex: string): Uint8Array | null
  has(sha256Hex: string): boolean
  gcOrphans(referenced: Iterable<string>): number
}
```

Write-once: existing file with different bytes → throw. Atomic temp+rename.

- [ ] **Step 1: Contract tests** (put/get/dedup/mismatch/gc)

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(project-assets-fs): content-addressed asset store`

---

### Task 4: sb3-tools canonical import/export (no stubs)

**Files:**
- Modify: `packages/sb3-tools/src/index.ts`, tests
- Keep Gate 0 stub export **renamed** (`exportSb3StubForGate0`) or gated behind `GATE0_ALLOW_STUB_EXPORT=1` so product cannot call it accidentally

```typescript
export function importToCanonical(
  projectJson: unknown,
  zipAssets: Map<string, Uint8Array>, // md5ext → bytes
  hashSha256: (b: Uint8Array) => string,
): { document: ProjectDocument; assets: Array<{ sha256: string; bytes: Uint8Array }> }

export async function exportFromCanonical(
  document: ProjectDocument,
  assetsBySha: Map<string, Uint8Array>,
): Promise<Uint8Array>
```

Rules: fail if any AssetRef missing bytes; fail if Scratch md5/`assetId` mismatch; **never** invent SVG.

- [ ] **Step 1: Failing tests** — round-trip fixture with real tiny wav/svg/png; stub regression forbidden

- [ ] **Step 2: Implement** using `loadSb3` / isolated + mapper

- [ ] **Step 3: PASS; commit** `feat(sb3-tools): canonical import/export with real assets`

---

### Task 5: Equivalence helper + corporeal fixtures

**Files:**
- Create: `packages/sb3-tools/src/canonical-equivalent.ts`, fixtures under `packages/sb3-tools/test-fixtures/`

`assertCanonicalEquivalent(a, b)` compares structure + asset bytes via sha sets.

- [ ] **Step 1–3: tests + helper; commit** `test(sb3-tools): canonical equivalence helper`

---

### Task 6: Persist server — AssetStore wiring + GC

**Files:**
- Modify: `apps/r1-persist-server/src/bootstrap.ts`, `limits.ts`
- Wire `R1_DATA_DIR/assets`; orphan GC with union of sha from all durable envelopes (head revisions + snapshot metas — define efficient scan in plan implementer: at least scan snapshot JSON files + head rows)

- [ ] **Step 1: Failing boot GC test**

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): wire FS asset store and GC`

---

### Task 7: HTTP import-sb3 / export-sb3 / GET asset

**Files:**
- Create: `apps/r1-persist-server/src/sb3-routes.ts`, `asset-authz.ts`
- Modify: `server.ts`, tests `sb3.routes.test.ts`

Auth matrix = existing google/stub. Import = multipart; Export = download; Asset GET checks ACL via “sha referenced by readable project”.

Issue codes: extend as needed (`UNSUPPORTED_FIELD`, `MISSING_ASSET`, `ASSET_BYTE_MISMATCH`, …).

- [ ] **Step 1: Failing HTTP tests**
  - import happy path stores assets + returns projectId
  - export → re-import equivalence
  - restart → export equivalence
  - missing costume → reject
  - path traversal ZIP → reject
  - BOLA asset sha from other org → 403/404
  - CSRF/Origin on import (google mode)

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): SB3 import export and authorized asset GET`

---

### Task 8: ProjectService save verifies assets exist

**Files:**
- Modify: `packages/project-service` to accept optional `assetStore.has` check on save/restore
- Tests: save referencing unknown sha → error

- [ ] **Step 1–3; commit** `feat(project-service): reject saves with missing asset objects`

---

### Task 9: Narrow Scratch host (E1)

**Files:**
- Create: `apps/r1-scratch-host/**` (Vite + React; pin fonts per repo UI rules if landing — this is app shell, keep utilitarian)

Minimum UX:

1. Login/stub identity banner
2. Import SB3 button → calls import API
3. Open project → render stage + sprite list + blocks workspace (vendor subset or Blockly host — choose during task; **must display real costumes**)
4. Edit one block field → autosave
5. Export SB3 download
6. Reload survives

If full Blockly host is too large, acceptable interim: **stage + sprite thumbnails from assets + “blocks JSON editor” disabled** is **not** OK — need real block edit. Prefer embed minimal scratch-gui packages or workspace from vendor with deferred paint.

- [ ] **Step 1: Smoke test (Playwright or vitest browser)** — import fixture → see costume → change variable → reload → export equivalence

- [ ] **Step 2: Implement host**

- [ ] **Step 3: PASS; commit** `feat(r1-scratch-host): narrow Scratch editor shell`

---

### Task 10: Docs + Go stub + scripts

**Files:**
- `docs/r1/SCRATCH_SB3.md`, `docs/r1/SCRATCH_SB3_GO_NO_GO.md`
- Root `package.json`: `r1:scratch:test`
- CI workflow paths for new packages/apps
- Update `PERSISTENCE.md` asset directory pointer

Verdict wording: **Technical Go** for fixture+host smoke; GIS remains separate conditional on auth.

- [ ] **Commit** `docs(r1): Scratch SB3 runbook and Go stub`

---

### Task 11: Final verification

```text
pnpm build
pnpm gate0:test
pnpm r1:persist:test
pnpm r1:auth:test
pnpm r1:scratch:test
```

- [ ] All green; working tree clean; fill GO_NO_GO evidence table

---

## Spec coverage self-check

| Requirement | Task |
|---|---|
| Asset bytes not in ProjectDocument JSON | 1, 3, 4 |
| Immutable sha256 asset store | 3, 6 |
| No silent stubs | 4, 7 |
| Equivalence ≠ ZIP hash | 5, 7 |
| Server ZIP + MIME/ext/size limits | 4, 7 |
| Import → edit → restart → export → re-import | 7, 9, 11 |
| Narrow GUI without dropping fidelity | 9 |
| Auth/CSRF/BOLA | 7 |
| Envelope hash includes assets | 2, 8 |

## Execution gate

**Do not implement until this design is approved.**
