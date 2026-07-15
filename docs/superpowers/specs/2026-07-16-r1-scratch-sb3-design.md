# Release 1 Slice — Scratch Editor Surface + Safe SB3 I/O Design

> **Date:** 2026-07-16
> **Status:** Revised draft for re-review (do not implement until approved)
> **Revision:** P1 tenant grants, V1 hash stability, SVG/media Go bars, spool/worker I/O, GC fail-closed, Task 0 Scratch spike (post-`3490bed`)
> **Baselines:** Gate 0 Technical Go @ `4a14e05`; R1 persistence Technical Go @ `3d6053b`; R1 auth Technical Go — real GIS conditional @ `570e237`
> **Vendor pin:** Scratch Editor `v14.1.0` / `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` (unchanged)
> **Spec anchors:** §6, §10–14, §40, §42–43, §55, §62
> **Approved direction:** Storage **A** + Editor **E1** + SB3 I/O **S1** (this revision keeps that triad; fills missing contracts)

## 1. Goal

Wire a **narrow Scratch editing surface** and **server-side safe SB3 import/export** to R1 persistence such that:

1. SB3 import creates a **new** project with **full costume/sound byte fidelity**
2. Meaning structure is durable in `ProjectDocument` (schemaVersion ≥ 2 for assets)
3. Asset **bytes** live in an **immutable content-addressed store**; **org grants** gate every read/use
4. Edit → autosave → process restart → export → re-import preserves **semantic + asset equivalence**
5. **No silent stubbing**; **unknown / unstoreable → hard reject** (no `acceptWarnings` API this slice)
6. Untrusted media is **validated in isolation** before any display path; original bytes retained for export

**Out of scope:** Yjs, teacher UI, AI, real GIS evidence, vendor pin change, ZIP byte-identical round-trip, full Scratch website UI, **approval UX for partial import**.

**Capacity rule:** shrink GUI breadth before weakening asset fidelity or tenant isolation.

## 2. Equivalence contract (Go condition)

### 2.1 Not required

- Bit-identical SB3 ZIP hashes.

### 2.2 Required

After **import → edit/save → restart → export → re-import** (modulo controlled edits):

| Layer | Must preserve |
|---|---|
| Structure | targets, blocks, variables, lists, broadcasts, allow-listed extensions, layer/currentCostume, Scratch 3 sprite/stage fields pinned in plan |
| Assets | Exact costume/sound **bytes**; no stubs |
| Metadata | `assetId`, `md5ext`, `dataFormat`, name, rotation centers / rate/sampleCount as applicable; refs consistent |
| Integrity | SHA-256 of bytes; Scratch md5/`assetId` match on import |

### 2.3 Unknown / unstoreable policy (fixed)

| Case | Behavior |
|---|---|
| Limit / path / ZIP malice | Hard reject — no project |
| Missing asset bytes / md5 or sha mismatch | Hard reject |
| Comments, monitors, disallowed extensions, unknown opcodes, fields outside allow-list | **Hard reject** |
| Partial import with user approval | **Out of scope** — remove any `acceptWarnings` design |

## 3. Approaches (approved triad + revised sub-decisions)

| Area | Approved choice | Notes |
|---|---|---|
| Storage | **A** content-addressed bytes + metadata in document | Plus **org-scoped grants** (P1) |
| Editor | **E1** narrow host | **Task 0 spike first** with Go/Stop (P1) |
| SB3 I/O | **S1** server import/export | Spool + worker + limits (P1) |

Rejected unchanged: B embed JSON, C opaque media folder as primary, browser-primary import, E3 headless-only as sole deliverable.

## 4. Tenant-scoped asset CAS (P1)

Global `has(sha)` alone is forbidden: a caller who learns another org’s sha could mint a document referencing it.

### 4.1 SQLite tables

```sql
asset_objects(
  sha256 TEXT PRIMARY KEY,           -- hex
  byte_length INTEGER NOT NULL,
  md5_hex TEXT NOT NULL,             -- Scratch assetId conventionally
  data_format TEXT NOT NULL,        -- from fixed allow-list
  created_at TEXT NOT NULL
);

organization_asset_grants(
  organization_id TEXT NOT NULL,
  sha256 TEXT NOT NULL REFERENCES asset_objects(sha256),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, sha256)
);
```

- FS bytes remain at `R1_DATA_DIR/assets/{sha256}` (write-once).
- **put** path: write bytes → insert `asset_objects` (if new) → insert grant for importing org (same sync TX as first durable project revision when possible).
- Concurrent imports of same bytes: `putIfAbsent` + `INSERT OR IGNORE` object + ensure grant for **this** org.

### 4.2 Mandatory checks (save / restore / export)

Not `has(sha)` alone. For every `CostumeRef` / `SoundRef` in the document:

1. `organization_asset_grants` contains `(caller.organizationId, contentSha256)`
2. `asset_objects.sha256` matches file digest
3. `md5_hex` == ref.`assetId`
4. stored `data_format` == ref.`dataFormat` (normalized)
5. `md5ext` suffix matches format allow-list and stem == `assetId`
6. `byte_length` == file length

Mismatch → reject entire save/restore/export.

### 4.3 Asset URL (project-scoped)

```text
GET /v1/projects/:projectId/assets/:sha256
```

Authorization: caller can read project **and** sha is referenced by that project’s **accessible durable state** (at least head; optionally a named snapshot id query later). Prefer head-only for R1 GET unless snapshot viewer is in scope.

**Do not** expose `/v1/assets/:sha256` without project scope.

## 5. Envelope / contentHash compatibility (P1)

### 5.1 Problem

Unconditionally changing `contentHash` to hash `{document, assetSha256s}` breaks existing V1 revision/snapshot verification. Asset shas already appear inside `AssetRef` fields when schemaVersion includes them — **correct per-version canonicalize of the document is enough**; a parallel manifest is unnecessary.

### 5.2 Rules

| Document `schemaVersion` | Canonicalizer | Existing V1 data |
|---|---|---|
| **1** (current) | **Unchanged** byte-for-byte canonical algorithm used today | Must continue to verify |
| **2+** (assets) | Extend `canonicalizeTarget` to include `CostumeRef`/`SoundRef` fields + `currentCostume` in **stable key order** | N/A for legacy rows |

- Maintain **schemaVersion-dispatched** `canonicalizeDocument(doc)` / `contentHash(doc)`.
- Do **not** introduce a silent second hashing pass that alters V1.
- If envelope-level hashing policy must change independently of document schema, introduce explicit **`hashVersion` on envelope** or **Envelope V2** — not a silent V1 break.
- **Regression tests required:** existing V1 create/save/snapshot/restore/idempotent replay remain green with **identical** `contentHash` expectations for the same V1 fixtures.

### 5.3 Empty projects

New empty projects in this slice may mint `schemaVersion: 2` with empty costume/sound arrays per §6.2 rules, or migrate only on first SB3 import — pin one policy in Plan Task 1.

## 6. ProjectDocument shape (P2)

### 6.1 Discriminated refs

```typescript
interface CostumeRef {
  kind: "costume"
  name: string
  assetId: string
  md5ext: string
  dataFormat: "svg" | "png" | "jpg" | "jpeg" | "bmp" | /* pin exact set from v14.1.0 */
  contentSha256: string
  rotationCenterX: number
  rotationCenterY: number
  bitmapResolution?: number
}

interface SoundRef {
  kind: "sound"
  name: string
  assetId: string
  md5ext: string
  dataFormat: "wav" | "mp3" /* pin exact set from v14.1.0 */
  contentSha256: string
  rate: number
  sampleCount: number
}
```

- Same `md5ext` may appear on **multiple costumes** (legitimate Scratch); **do not** invent uniqueness constraints on `(target, md5ext)`.
- `currentCostume`: integer index into `costumes[]`. If `costumes.length === 0`, document is **invalid for schemaVersion 2+** except possibly ephemeral builder states that **never** save — R1 product rule: **stage and sprites must have ≥1 costume before durable save**; import must ensure that. `currentCostume` must satisfy `0 <= currentCostume < costumes.length`.

### 6.2 Format allow-list

Derived from Scratch Editor **v14.1.0** media conventions (plan pins exact enum tables from vendor/source). Validation is **allow-list only** — not “where feasible” sniffing alone. Sniff may corroborate; mismatch → reject.

## 7. Untrusted SVG / media (Go conditions) (P1)

| Rule | Requirement |
|---|---|
| Retention | **Original** validated bytes stored immutably for export |
| Display | Before any UI/VM display decode: **safety validation** in an **isolated process** |
| Dangerous SVG | Reject for **display path** if script / event attributes / external refs / `foreignObject` / etc. Detected (exact detector pack pinned in Plan) |
| Delivery | **Never** serve asset as same-origin navigable active SVG; responses use `X-Content-Type-Options: nosniff`, safe `Content-Type` (e.g. `image/svg+xml` only with disposition that prevents scripted browsing — prefer `Content-Disposition: attachment` for download and **non-scriptable** display strategy such as sanitized rasterization **or** sandboxed iframe with opaque origin / `Content-Security-Policy: sandbox` without allow-scripts — pin one approach in Plan Task 0/media) |
| Decode/parse | ZIP + media parse + SVG inspect run under heap/time-limited worker |

Export may return original bytes inside SB3 even when display rejected an unsafe SVG **only if** product policy chooses “store but do not open in host”; R1 **default**: **reject import** of unsafe SVG so display and export stay aligned. Pin: **hard reject import** of SVG failing safety scan.

## 8. Import / export isolation boundary (P1)

```text
HTTP multipart
  → stream to size-capped temp file (reject before full RAM ZIP)
  → spawn worker (max-old-space-size + wall clock)
       - zip parse, limits, extract entries to worker temp dir
       - md5/sha, format allow-list, SVG safety
       - write verified assets to holding dir OR stream results as manifest
  → parent receives: ImportManifest (JSON) + paths to verified asset files
       - NO giant Map clone over IPC
  → parent: grants + asset_objects + createProject TX
  → always: kill worker on timeout; close; delete temps (tested)
```

Export similarly: output size / time / memory caps; worker or bounded assembler; timeout kill + cleanup tests.

## 9. GC reference set + fail-closed (P1)

Referenced sha256 set **must** include:

1. All **durable project revisions**’ documents (full history in SQLite)
2. All **snapshot** envelope payloads on disk
3. **In-flight** import/commit protection set (lease table or temp grant rows)
4. All `organization_asset_grants.sha256`

**Do not** GC from “head + snapshots only”.

On **any** scan failure, unknown `schemaVersion`, or corrupt JSON: **abort entire GC** (fail-closed). Prefer **quarantine** (`assets/.quarantine/{sha}` + grace period) over immediate unlink. Document residual risk if quarantine disk fills.

Optional later: revision discard policy must be designed **before** narrowing the reference set.

## 10. Scratch host — fixed Task 0 spike (P1)

**First candidate:** embed vendor **scratch-gui / scratch-vm / scratch-blocks** from pin `v14.1.0` via the monorepo vendor tree (workspace package load or built assets), wrapped by `apps/r1-scratch-host`.

### Task 0 Go / Stop

| Criterion | Go | Stop |
|---|---|---|
| Pin alone embeds workspace + stage | Yes without fork | Need vendor patch → **STOP implementation**; escalate fork/ADR |
| Real costumes/sounds display + run | Yes | Cannot without stubbing → Stop |
| Capture block create / delete / connect / field edit | Yes | Stop |
| Rebuild `ProjectDocument` from VM/workspace **without dropping assets** | Yes | Stop |

Until Task 0 Go, Tasks 9 host completeness may not claim editor Go. Server SB3 Tasks may proceed in parallel after grants/schema land.

**Conversion responsibility:** Host is the **only** browser component allowed to mutate the editing Document; server never trusts client-supplied asset **bytes** on save (refs + grants only). Import/export machines own bind/unbind of ZIP ↔ (document, assets).

## 11. Package diagram

```text
project-schema          CostumeRef/SoundRef, schemaVersion 2, validators
project-envelope        schemaVersion-dispatched canonicalize (V1 frozen)
project-assets-fs       putIfAbsent/get/quarantine helpers (bytes only)
project-store-sqlite    asset_objects + organization_asset_grants + verify API
sb3-tools               spool-aware worker entry; importToCanonical/exportFromCanonical; SVG inspect worker
project-service         save/restore: full grant+meta verify (before HTTP polish)
r1-persist-server       import/export routes; project-scoped asset GET; GC
r1-scratch-host         narrow GUI after Task 0 Go
```

## 12. HTTP API (additive)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/projects/import-sb3` | multipart → spool file; hard reject unknowns |
| `GET` | `/v1/projects/:id/export-sb3` | capped export |
| `GET` | `/v1/projects/:projectId/assets/:sha256` | project-scoped; nosniff; safe CT/Disposition |

No unscoped `/v1/assets/:sha256`. No `acceptWarnings`.

## 13. Acceptance matrix (blocking)

Prior equivalence + limits, **plus**:

- Cross-org sha forgery on save/GET → reject
- Import failure leaves no grant / no half project (or rolled back)
- Crash between asset write and DB commit → restart safe (no readable orphan grants; bytes may quarantine)
- Concurrent same-asset import for two orgs → two grants, one object
- Concurrent same-org import → single object + grant
- GC scan failure / corrupt revision → GC aborts; no mass delete
- Unsafe SVG import rejected
- V1 persistence fixture regression (hash stable)
- Host: block add/connect/delete + green flag (after Task 0 Go)

## 14. Review checklist

- [x] A + E1 + S1 retained
- [ ] Org grants + project-scoped asset URLs
- [ ] V1 contentHash frozen; V2 schema via document fields
- [ ] SVG/media isolation + delivery policy as Go
- [ ] Spool/worker/IPC/temp cleanup in Plan
- [ ] GC full revision set + fail-closed quarantine
- [ ] Task 0 Scratch spike Go/Stop
- [ ] P2 type/format/currentCostume/acceptance updates

## 15. Next after Go

Paint/sound editors, approval UX for partial imports, stronger SVG rewriting (vs reject), quotas, Envelope V2 only if needed beyond schemaVersion.
