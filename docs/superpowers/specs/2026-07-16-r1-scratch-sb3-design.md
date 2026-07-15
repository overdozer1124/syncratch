# Release 1 Slice — Scratch Editor Surface + Safe SB3 I/O Design

> **Date:** 2026-07-16
> **Status:** Revised draft for re-review (do not implement until approved)
> **Revision:** comments/monitors empty OK, block mutation pin, GC/quota races, SVG parser pin, equivalence pairing (post-`3d228cd`)
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

**Out of scope:** Yjs, teacher UI, AI, real GIS evidence, vendor pin change, ZIP byte-identical round-trip, full Scratch website UI, **approval UX for partial import**, **non-empty comments/monitors round-trip**.

**Capacity rule:** shrink GUI breadth before weakening asset fidelity or tenant isolation.

## 2. Equivalence contract (Go condition)

### 2.1 Not required

- Bit-identical SB3 ZIP hashes.
- Stable Scratch block UIDs across export → re-import (see §6.7 target pairing + block graph normalization).

### 2.2 Required

After **import → edit/save → restart → export → re-import** (modulo controlled edits):

| Layer | Must preserve |
|---|---|
| Structure | All **保持** fields in §6.4–§6.5 (targets, blocks incl. **mutation**, variables, lists, broadcasts, extensions, sprite/stage pose, layerOrder, currentCostume) |
| Assets | Exact costume/sound **bytes**; no stubs |
| Metadata | `assetId`, `md5ext`, canonical `dataFormat`, name, rotation centers / rate / sampleCount / sound `format` as applicable; refs consistent |
| Integrity | SHA-256 of bytes; Scratch md5/`assetId` match on import |

### 2.3 Unknown / unstoreable policy (fixed)

| Case | Behavior |
|---|---|
| Limit / path / ZIP malice | Hard reject — no project |
| Missing asset bytes / md5 or sha mismatch | Hard reject |
| **Non-empty** `comments` / `monitors` / block `comment` | Hard reject |
| Legacy SB2 keys, unknown top-level/target keys | Hard reject |
| Disallowed extensions / opcodes (§6.6) | Hard reject |
| Reference to `gc_state != 'live'` asset | Hard reject (save/import/GET) |
| Partial import with user approval | **Out of scope** |

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
-- organizations table already exists from auth slice; FK enforced here.

asset_objects(
  sha256 TEXT PRIMARY KEY
    CHECK(length(sha256) = 64 AND lower(sha256) NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  md5_hex TEXT NOT NULL
    CHECK(length(md5_hex) = 32 AND lower(md5_hex) NOT GLOB '*[^0-9a-f]*'),
  data_format TEXT NOT NULL
    CHECK(data_format IN ('svg','png','jpg','bmp','gif','wav','mp3')),
  gc_state TEXT NOT NULL DEFAULT 'live'
    CHECK(gc_state IN ('live','quarantining','quarantined')),
  quarantine_started_at TEXT,
  created_at TEXT NOT NULL
);

organization_asset_grants(
  organization_id TEXT NOT NULL
    REFERENCES organizations(organization_id),
  sha256 TEXT NOT NULL REFERENCES asset_objects(sha256),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, sha256)
);

asset_import_leases(
  lease_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  sha256 TEXT NOT NULL
    CHECK(length(sha256) = 64 AND lower(sha256) NOT GLOB '*[^0-9a-f]*'),
  import_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Quota reservation for concurrent imports (distinct sha set + bytes).
organization_asset_quota_reservations(
  reservation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  import_session_id TEXT NOT NULL UNIQUE,
  reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes >= 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

organization_asset_quota_reservation_shas(
  reservation_id TEXT NOT NULL
    REFERENCES organization_asset_quota_reservations(reservation_id),
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  PRIMARY KEY (reservation_id, sha256)
);

CREATE INDEX asset_import_leases_expires ON asset_import_leases(expires_at);
CREATE INDEX asset_import_leases_session ON asset_import_leases(import_session_id);
CREATE INDEX asset_objects_gc_state ON asset_objects(gc_state);
CREATE INDEX quota_reservations_expires ON organization_asset_quota_reservations(expires_at);
```

- FS live bytes: `R1_DATA_DIR/assets/{sha256}` (write-once while `gc_state='live'`).
- Quarantined bytes: `R1_DATA_DIR/assets/.quarantine/{sha256}`.
- All sha columns stored **lowercase** hex.

### 4.2 Mandatory checks (save / restore / export / import)

For every `CostumeRef` / `SoundRef`:

1. `asset_objects.gc_state === 'live'` (reject `quarantining` / `quarantined`)
2. `organization_asset_grants` contains `(caller.organizationId, contentSha256)`
3. `asset_objects.sha256` matches file digest
4. `md5_hex` == ref.`assetId`
5. stored `data_format` == ref.`dataFormat` (canonical §6.2)
6. `md5ext` suffix matches canonical format and stem == `assetId`
7. `byte_length` == file length
8. Sound: `rate` / `sampleCount` rules (§6.3)

Mismatch → reject entire save/restore/export/import.

### 4.3 Asset URL (project-scoped, head-only)

```text
GET /v1/projects/:projectId/assets/:sha256
```

- **Head-only for R1:** sha must appear in the project’s **current head envelope document**.
- Authorization: caller can read project **and** head document references sha **and** object is `gc_state='live'`.
- Response headers (all formats including SVG):
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename="{sha256}"`
  - `X-Content-Type-Options: nosniff`
- **Do not** expose `/v1/assets/:sha256` without project scope.

### 4.4 Import SQLite atomicity (fixed — no nested transactions)

`ProjectService.createProject` starts its own `withTransaction` internally. Import **must not** call it inside another transaction.

**Boundary split:**

| Phase | Where | Transaction |
|---|---|---|
| Spool + worker ZIP parse, media limits, SVG safety, extract to holding dir | Worker process | **Outside** SQLite |
| FS `putIfAbsent` verified bytes → `R1_DATA_DIR/assets/{sha256}` | Parent, pre-TX | **Outside** SQLite |
| Quota reservation + object/grant/project/revision 0 + lease/reservation release | Parent | **Single synchronous TX** (`BEGIN IMMEDIATE`) |
| Worker kill + temp dir cleanup | Parent `finally` | Outside TX |

**Import-only API:**

```typescript
importSb3CreateProjectAtomic(input: {
  organizationId: string
  ownerUserId: string
  projectId: string
  title: string
  envelope: ProjectEnvelopeV1 // revision 0
  assetObjects: Array<{ sha256; byteLength; md5Hex; dataFormat }>
  grantShas: string[]
  releaseImportSessionId: string // leases + quota reservation
}): ProjectHead
```

**Inside the same TX (order matters):**

1. Re-check org + global quota using **distinct sha union** (§4.6) including this import’s new shas.
2. Insert `asset_objects` (if new, `gc_state='live'`) + grants.
3. Insert project + revision 0.
4. Delete import leases + quota reservation for session.

**Rollback:** no project/revision/grant/object rows; FS orphan bytes only; reservation released on failure path via lease/reservation TTL.

### 4.5 Path safety (contentSha256 → FS)

`path.resolve` alone is **insufficient** (does not neutralize symlinks/reparse points).

Before any read/write:

1. Reject sha not matching `/^[0-9a-f]{64}$/`.
2. **Validate `assetsRoot` at startup:** `lstat` + `realpath`; must be a directory; must not be a symlink/reparse point escaping intended data dir.
3. Candidate file path `join(assetsRoot, sha256)`:
   - `lstat` candidate; reject if symlink/reparse point/junction.
   - `realpath(assetsRoot)` must prefix `realpath(candidate)` when candidate exists.
4. Open with **no-follow** semantics (POSIX `O_NOFOLLOW`; Windows: reject reparse/symlink before open — document platform tests).
5. Never follow symlinks inside `assets/`, `assets/.quarantine/`, spool, or holding dirs.

### 4.6 Capacity quotas (R1)

| Limit | Value | Enforcement |
|---|---|---|
| Per-asset byte length | 10 MiB | Worker + `asset_objects.byte_length` |
| Per-organization referenced asset bytes | **512 MiB** | **Distinct sha union** across all durable revisions in org **plus** active quota reservations (§4.6.1) |
| Total on-disk under `R1_DATA_DIR` | **2 GiB** | Sum live + quarantine asset bytes **+ spool + holding + temp** (§4.6.2) |
| Per-project import ZIP spool | 32 MiB | HTTP stream cap |

#### 4.6.1 Org quota — distinct sha union

For organization `O`:

```text
quotaBytes(O) = SUM(byte_length) for sha in UNION(
  { contentSha256 from every durable revision document of projects in O },
  { sha256 in active organization_asset_quota_reservation_shas for O where reservation.expires_at > now }
)
```

Same sha referenced by multiple revisions counts **once**. Import/save TX must recompute under `BEGIN IMMEDIATE` before commit.

#### 4.6.2 Global disk guard

Before accepting spool write, holding write, or `putIfAbsent`:

```text
diskUsage = bytes(assets/live) + bytes(assets/.quarantine) + bytes(import-spool/) + bytes(import-holding/) + bytes(worker-temp/)
```

Reject when `diskUsage + incoming > 2 GiB`.

## 5. Envelope / contentHash compatibility (P1)

### 5.1 Problem

Unconditionally changing `contentHash` breaks V1 verification. Per-version canonicalize of the document (including asset refs and **mutation**) is sufficient.

### 5.2 Rules

| Document `schemaVersion` | Canonicalizer | Existing V1 data |
|---|---|---|
| **1** (current) | **Unchanged** | Must continue to verify |
| **2+** (assets) | Extend `canonicalizeTarget` with §6.4–§6.5 **保持** fields + stable `mutation` key order | N/A for legacy rows |

- **Regression tests required:** V1 golden hashes unchanged.

### 5.3 Empty projects

**Pinned:** `createProject` → schemaVersion **1**. First SB3 import → schemaVersion **2**.

## 6. ProjectDocument shape + Scratch project.json field pin

**Source of truth:** Scratch Editor **v14.1.0** — `packages/scratch-vm/src/serialization/sb3.js` and `deserialize-assets.js`.

### 6.1 Discriminated refs + blocks

```typescript
type CostumeDataFormat = "svg" | "png" | "jpg" | "bmp" | "gif"
type SoundDataFormat = "wav" | "mp3"

interface ScratchBlock {
  id: string
  opcode: string
  next: string | null
  parent: string | null
  inputs: Record<string, unknown>   // SB3 serialized input arrays (§6.5)
  fields: Record<string, unknown>   // SB3 serialized field arrays (§6.5)
  shadow?: boolean
  topLevel?: boolean
  x?: number
  y?: number
  mutation?: Record<string, unknown> // required when present in SB3; canonicalized
}

interface CostumeRef { /* unchanged from prior revision */ }
interface SoundRef { /* unchanged from prior revision */ }
```

### 6.2 Format allow-list and canonical aliases

(Costume/sound tables unchanged — `jpeg` → **`jpg`**.)

### 6.3 Media decode limits + audio metadata

| Format | Limit | Verification |
|---|---|---|
| PNG / JPEG / GIF / BMP | Max **4096×4096** px; max **16_777_216** px | Decode header in worker |
| SVG | Max **512 KiB** text; max **65_536** DOM nodes | `@xmldom/xmldom@0.8.10` parse (§7) |
| WAV | Max **60 s**; max **5_292_000** PCM samples (`44100 × 60 × 2` stereo ceiling) | RIFF `fmt` + `data` |
| MP3 | Max **60 s** duration | Valid MP3 structure |

**`rate` / `sampleCount` meaning (pinned via vendor fixture corpus):**

| Format | Rule |
|---|---|
| **WAV** | `rate` == `fmt.sampleRate`; `sampleCount` == PCM sample frames in `data` (exact, channels per Scratch SB3 convention) |
| **MP3** | `sampleCount` is **Scratch SB3 metadata** (same semantics Scratch stores in `project.json`) — **preserve on round-trip**; import verifies valid MP3 + `rate > 0` + `sampleCount > 0` + implied duration `sampleCount/rate ≤ 60s`; **do not reject** solely because MPEG frame scan yields a different sample count (encoder delay/padding). |

**Golden corpus (Task 7 tests):** record `(assetId, rate, sampleCount, md5ext)` from vendor fixtures:

- WAV: `vendor/scratch-editor/packages/scratch-vm/tap-snapshots/vm-state-snapshot/origin.sb3.json` (`pop` 44100/1032; `Meow` 44100/37376)
- MP3: at least one fixture from `scratch3_music` drum assets once packaged into test SB3

Equivalence asserts **exact** `(rate, sampleCount)` preservation export → re-import.

### 6.4 Scratch 3 `project.json` field classification (v14.1.0)

**Top-level**

| Field | Policy | Notes |
|---|---|---|
| `targets` | **保持** | Required |
| `meta` | **保持** | `semver`, `vm`, `agent`, `origin` |
| `extensions` | **保持** | Must ⊆ §6.6 |
| `monitors` | **正規化** | **`[]` only** — accept, store as empty, export as `[]` |
| `monitors` non-empty | **明示拒否** | |
| Unknown top-level keys | **明示拒否** | |

**Target — common**

| Field | Policy | Notes |
|---|---|---|
| `isStage`, `name`, `variables`, `lists`, `broadcasts` | **保持** | |
| `blocks` | **保持** | See §6.5 |
| `comments` | **正規化** | **`{}` only** — accept (vendor `serializeTarget` always emits) |
| `comments` non-empty | **明示拒否** | |
| `currentCostume`, `costumes`, `sounds`, `volume`, `layerOrder` | **保持** | |
| `scripts`, `targetPaneOrder` | **明示拒否** | |
| Unknown target keys | **明示拒否** | |

**Stage-only / sprite-only / costume / sound tables:** unchanged from prior revision.

**Export normalization:** always emit `comments: {}` per target and `monitors: []` at top level (match vendor SB3).

### 6.5 SB3 block object classification (v14.1.0)

**Non-primitive block object** (map value is object, not array):

| Field | Policy | Notes |
|---|---|---|
| `opcode` | **保持** | |
| `next` | **保持** | Include explicit `null` |
| `parent` | **保持** | |
| `inputs` | **保持** | SB3 serialized arrays (§6.5.1) |
| `fields` | **保持** | SB3 serialized arrays (§6.5.2) |
| `shadow` | **保持** | |
| `topLevel` | **保持** | |
| `x`, `y` | **保持** | When `topLevel` (rounded int on export) |
| `mutation` | **保持** | Canonicalize stable key order; **required for custom blocks** |
| `comment` | **明示拒否** | Block-attached comment id |
| Unknown keys | **明示拒否** | |

**Primitive block map entries** (map value is array — top-level or inline in inputs):

| Form | Policy | Notes |
|---|---|---|
| `[4..13, …]` primitive constants | **保持** | `MATH_NUM`, `VAR`, `LIST`, etc. per `sb3.js` |
| Inline primitive in `inputs` | **保持** | e.g. `[1, [4, 10]]` |

#### 6.5.1 Input array encodings (serialized SB3)

| `input[0]` | Meaning | Policy |
|---|---|---|
| `1` | Same block + shadow | **保持** |
| `2` | Block, no shadow | **保持** |
| `3` | Different block + shadow | **保持** |
| `[4..13, …]` | Inline primitive | **保持** |

#### 6.5.2 Field array encodings

| Form | Policy |
|---|---|
| `[value]` | **保持** |
| `[value, id]` | **保持** (variables/lists/broadcasts) |

#### 6.5.3 Custom procedure / mutation fixtures (required tests)

Pin golden graphs derived from vendor `test/unit/serialization_procedures.js`:

| Fixture | Opcodes | `mutation` must preserve |
|---|---|---|
| **Procedure definition (new format)** | `procedures_definition` → `procedures_prototype` → body | `proccode`, `argumentids`, `argumentnames`, `argumentdefaults`, `warp`, `tagName`, `children` |
| **Procedure call** | `procedures_call` | `proccode`, argument id arrays / warp as serialized by VM |
| **Argument reporter** | `argument_reporter_string_number` etc. | fields + attachment to prototype |

Import → export → re-import must preserve **mutation** bytes-equivalent after canonicalization (custom blocks runnable).

### 6.6 R1 opcode / extension allow-list

**Built-in opcode prefixes** (no `project.extensions` entry required — includes standard **procedures**):

`argument_`, `colour_`, `control_`, `data_`, `event_`, `looks_`, `math_`, `motion_`, `operator_`, `procedures_`, `sensing_`, `sound_`

Plus menu/shadow opcodes: `math_number`, `math_positive_number`, `math_whole_number`, `math_integer`, `math_angle`, `colour_picker`, `text`, `event_broadcast_menu`, `data_variable`, `data_listcontents`.

**Allowed extension IDs** (`project.extensions` must be a subset; opcode `extId_*` requires `extId` listed):

| Extension ID | Notes |
|---|---|
| `music` | |
| `pen` | |
| `videoSensing` | |
| `text2speech` | |
| `translate` | |

**Explicit reject** (non-exhaustive): `wedo2`, `ev3`, `microbit`, `makeymakey`, `gdxfor`, `boost`, any URL-shaped extension id, any unknown id.

Empty `extensions: []` is valid for core-only + custom procedure projects.

### 6.7 Equivalence — target pairing + block graph (export → re-import)

Scratch regenerates target ids and often block ids on re-import. Production equivalence (**Task 7 `equivalenceProduction`**, same rules as Task 0 spike) uses:

**Target pairing:**

1. Stage: sole target with `isStage === true`.
2. Sprites: match by **`name`** (reject duplicate sprite names on import).
3. Compare paired targets on all §6.4 **保持** fields except `id`.

**Block graph comparison:**

1. Normalize each target’s blocks to a **structure-only fingerprint** independent of Scratch UIDs:
   - Top-level blocks identified by `(opcode, x, y)` ordering tie-break.
   - Walk `next` / `inputs` / `parent` preserving opcode, serialized inputs/fields, and **`mutation` canonical JSON**.
2. Compare normalized graphs for equality.
3. Custom procedure fixtures (§6.5.3) must pass after export → re-import.

**Asset refs:** compare by `(assetId, contentSha256, canonical dataFormat, md5ext, …)` not by target id.

## 7. Untrusted SVG / media (fixed) (P1)

### 7.1 Import safety (worker — hard reject)

| Item | Pinned choice |
|---|---|
| XML/SVG parser | **`@xmldom/xmldom@0.8.10`** — explicit **product** dependency in `packages/sb3-tools` (not present in vendor lockfile; pin in package.json) |
| CSS scan | **`css-tree@3.2.1`** (vendor `scratch-svg-renderer` pin) |
| Regex-only gate | **Forbidden** as sole inspection |
| `data:` URIs | **R1: full reject** — no `data:` in href/xlink/style/url() |
| `#fragment` internal refs | Allowed for same-document SVG fragments only |

**Explicit reject if any:**

- `DOCTYPE`, internal/external **ENTITY** declarations, **processing instructions** (`<?…?>`)
- Disallowed elements: `script`, `foreignObject`, `iframe`, `embed`, `object`, external `use`
- Event attributes `/^on/i`
- External URI schemes in href/xlink (`http:`, `https:`, `javascript:`, `data:`)
- CSS **`@import`**; external **`url(`** in styles (css-tree walk + Raw fallback)
- Node/byte limits (§6.3)

### 7.2 Asset HTTP delivery

All assets: **`application/octet-stream`** + **`Content-Disposition: attachment`** + **`nosniff`** (§4.3).

### 7.3 Host display path (Task 0 must prove)

Fetch octet-stream → `runtime.storage.createAsset(...)` — **never** `<img src>` / same-origin navigable SVG URL (unchanged).

### 7.4 Worker isolation

ZIP + media parse + SVG inspect under heap/time-limited worker; kill + temp cleanup tested.

## 8. Import / export isolation boundary (P1)

(Unchanged flow; quota reservation created before FS put, committed/released in import TX §4.4.)

## 9. Grant / lease / GC lifecycle + race closure (P1)

### 9.1 Roles

(Grants = authorization; leases/reservations = in-flight; GC reference set excludes grants alone — unchanged intent.)

### 9.2 Import leases + quota reservations

| Event | Behavior |
|---|---|
| After worker manifest | Insert leases + **quota reservation** (distinct shas + byte sum) TTL **15m** |
| Import TX success | Delete leases + reservation (same TX) |
| Failure / crash | TTL expiry releases reservation; expired excluded from quota union |

### 9.3 GC byte reference set

Union of `contentSha256` from: all revisions + all snapshots + active leases (`expires_at > now`).

### 9.4 GC quarantine state machine (closes scan→rename race)

**Problem:** scan-then-rename allows a new revision to reference sha between phases.

**Pinned algorithm:**

```text
1. Read-only scan → candidate set C (unreferenced shas, gc_state='live')
2. For each sha in C (serialized GC worker):
     BEGIN IMMEDIATE
       Re-query: sha still unreferenced in revisions/snapshots/leases?
       If referenced → ROLLBACK; skip
       UPDATE asset_objects SET gc_state='quarantining' WHERE sha256=? AND gc_state='live'
       DELETE FROM organization_asset_grants WHERE sha256=?
     COMMIT
     FS: rename assets/{sha} → assets/.quarantine/{sha} (no-follow)
     BEGIN IMMEDIATE
       If rename succeeded: SET gc_state='quarantined', quarantine_started_at=now
       If rename failed: SET gc_state='live' (reconcile — see §9.7)
     COMMIT
3. After 7-day grace + successful full scan: delete quarantined file + asset_objects row
```

**Save/import/GET:** reject any ref where `gc_state != 'live'`.

### 9.5 Grant revocation

Grant rows deleted in step 2 when entering `quarantining` (same TX as re-check). `asset_objects` row removed only after quarantine grace + final delete.

### 9.6 Quarantine + final delete

7-day grace; fail-closed abort on scan error; no partial mass delete.

### 9.7 Startup reconcile

On persist-server boot:

| Condition | Action |
|---|---|
| `gc_state='quarantining'` | If live file missing and quarantine file present → `quarantined`; if live present → `live` + restore grants if still referenced |
| `gc_state='quarantined'` but file only in live path | Move to quarantine or reset state per fs truth |
| Orphan live file, no DB row | GC candidate |
| Expired reservations/leases | Delete rows |

## 10. Scratch host — Task 0 spike (P1)

### 10.1 Provisional schema + fixture

| Artifact | Path |
|---|---|
| Provisional types | `apps/r1-scratch-host/spike/schema/document-spike-v0.ts` (include `mutation` on blocks) |
| Expected document | `apps/r1-scratch-host/spike/fixtures/cat-with-sound.expected.json` |
| Procedure fixture | `apps/r1-scratch-host/spike/fixtures/custom-procedure.expected.json` |

**`equivalenceSpikeV0`:** §6.7 pairing rules; §6.4–§6.5 preserve set; empty `comments`/`monitors` normalized.

### 10.2 Task 0 Go / Stop

(Criteria unchanged + custom procedure mutation smoke + §7.3 display path.)

## 11. Package diagram

```text
project-schema          §6.4–§6.5 fields, mutation, validators, §6.6 allow-list
project-envelope        V1 frozen; V2 canonicalize mutation + pose + assets
project-assets-fs       put/get/quarantine; §4.5 lstat/realpath/no-follow
project-store-sqlite    objects+grants+leases+reservations+gc_state+atomic import
sb3-tools               worker; equivalenceProduction; SVG §7; audio corpus
project-service         verify live assets; atomic import
r1-persist-server       routes; GC state machine §9.4; reconcile §9.7
r1-scratch-host         after Task 0 Go
```

## 12. HTTP API (additive)

(Unchanged paths; import uses quota reservation + atomic TX.)

## 13. Acceptance matrix (blocking)

Prior items **plus**:

- Vendor `origin.sb3`-class project with empty `comments`/`monitors` **imports successfully**
- Non-empty comments/monitors/block comment → reject
- Custom procedure SB3 survives export → re-import (`mutation` preserved)
- GC concurrent with import/save does not quarantine referenced sha
- Quota concurrent imports cannot exceed org/global caps
- `gc_state='quarantining'` asset rejected on save
- Startup reconcile recovers crashed GC mid-flight
- MP3 equivalence uses fixture corpus `(rate, sampleCount)` — not frame-derived ±1

## 14. Review checklist

- [x] Empty comments/monitors normalized; non-empty rejected
- [x] Block + mutation classification (§6.5)
- [x] GC quarantining TX + reconcile (§9.4–§9.7)
- [x] Quota distinct-sha union + reservations (§4.6)
- [x] `@xmldom/xmldom@0.8.10` pinned; `data:` rejected (§7)
- [x] Hex CHECK fixed; path lstat/realpath (§4.1, §4.5)
- [x] WAV sample ceiling corrected; MP3 corpus semantics (§6.3)
- [x] Extension allow-list (§6.6)
- [x] equivalenceProduction target pairing (§6.7)

## 15. Next after Go

Non-empty comments/monitors round-trip, hardware extensions, explicit grant purge API, paint/sound editors.
