# Release 1 Slice — Scratch Editor Surface + Safe SB3 I/O Design

> **Date:** 2026-07-16
> **Status:** Revised draft for re-review (do not implement until approved)
> **Revision:** P1/P2 closure — Scratch field pin, import TX, SVG/display fixed, lease/GC/quota, dataFormat limits (post-`d64adee`)
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
| Structure | All **保持** fields in §6.4 (targets, blocks, variables, lists, broadcasts, extensions, sprite/stage pose, layerOrder, currentCostume) |
| Assets | Exact costume/sound **bytes**; no stubs |
| Metadata | `assetId`, `md5ext`, canonical `dataFormat`, name, rotation centers / rate / sampleCount / sound `format` as applicable; refs consistent |
| Integrity | SHA-256 of bytes; Scratch md5/`assetId` match on import |

### 2.3 Unknown / unstoreable policy (fixed)

| Case | Behavior |
|---|---|
| Limit / path / ZIP malice | Hard reject — no project |
| Missing asset bytes / md5 or sha mismatch | Hard reject |
| **明示拒否** fields in §6.4 (comments, monitors, legacy SB2 keys, unknown top-level keys) | Hard reject |
| Disallowed extensions, unknown opcodes | Hard reject |
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
-- organizations table already exists from auth slice; FK enforced here.

asset_objects(
  sha256 TEXT PRIMARY KEY
    CHECK(length(sha256) = 64 AND sha256 GLOB '[0-9a-f][0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  md5_hex TEXT NOT NULL
    CHECK(length(md5_hex) = 32 AND md5_hex GLOB '[0-9a-f][0-9a-f]*'),
  data_format TEXT NOT NULL
    CHECK(data_format IN ('svg','png','jpg','bmp','gif','wav','mp3')),
  created_at TEXT NOT NULL
);

organization_asset_grants(
  organization_id TEXT NOT NULL
    REFERENCES organizations(organization_id),
  sha256 TEXT NOT NULL REFERENCES asset_objects(sha256),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, sha256)
);

-- In-flight import protection (NOT mixed into grants).
asset_import_leases(
  lease_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  sha256 TEXT NOT NULL
    CHECK(length(sha256) = 64 AND sha256 GLOB '[0-9a-f][0-9a-f]*'),
  import_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX asset_import_leases_expires ON asset_import_leases(expires_at);
CREATE INDEX asset_import_leases_session ON asset_import_leases(import_session_id);
```

- FS bytes remain at `R1_DATA_DIR/assets/{sha256}` (write-once). **Never** join paths without passing §4.5 hex + containment checks.
- Concurrent imports of same bytes: `putIfAbsent` on FS (outside TX) + single TX inserts object (if new) + grant + project revision 0.

### 4.2 Mandatory checks (save / restore / export)

Not `has(sha)` alone. For every `CostumeRef` / `SoundRef` in the document:

1. `organization_asset_grants` contains `(caller.organizationId, contentSha256)`
2. `asset_objects.sha256` matches file digest
3. `md5_hex` == ref.`assetId`
4. stored `data_format` == ref.`dataFormat` (canonical form from §6.2)
5. `md5ext` suffix matches canonical format and stem == `assetId`
6. `byte_length` == file length
7. Sound: `rate` / `sampleCount` match parsed audio (§6.3)

Mismatch → reject entire save/restore/export.

### 4.3 Asset URL (project-scoped, head-only)

```text
GET /v1/projects/:projectId/assets/:sha256
```

- **Head-only for R1:** sha must appear in the project’s **current head envelope document**. Snapshot-scoped asset GET is **out of scope** (no `?snapshot=` parameter).
- Authorization: caller can read project **and** head document references sha.
- Response headers (all formats including SVG):
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename="{sha256}"`
  - `X-Content-Type-Options: nosniff`
- **Do not** expose `/v1/assets/:sha256` without project scope.
- **Do not** serve SVG as `image/svg+xml` on a same-origin navigable URL.

### 4.4 Import SQLite atomicity (fixed — no nested transactions)

`ProjectService.createProject` starts its own `withTransaction` internally. Import **must not** call it inside another transaction.

**Boundary split:**

| Phase | Where | Transaction |
|---|---|---|
| Spool + worker ZIP parse, media limits, SVG safety, extract to holding dir | Worker process | **Outside** SQLite |
| FS `putIfAbsent` verified bytes → `R1_DATA_DIR/assets/{sha256}` | Parent, pre-TX | **Outside** SQLite |
| Insert `asset_objects`, `organization_asset_grants`, project row, revision 0 envelope | Parent | **Single synchronous TX** on shared better-sqlite3 connection |
| Delete `asset_import_leases` for session | Same TX as above | Committed with project |
| Worker kill + temp dir cleanup | Parent `finally` | Outside TX |

**Import-only API (repository + service):**

```typescript
// project-store-sqlite — one db.transaction() callback; no nested withTransaction.
importSb3CreateProjectAtomic(input: {
  organizationId: string
  ownerUserId: string
  projectId: string
  title: string
  envelope: ProjectEnvelopeV1 // revision 0
  assetObjects: Array<{ sha256; byteLength; md5Hex; dataFormat }>
  grantShas: string[]
  releaseLeaseSessionId: string
}): ProjectHead
```

**Rollback semantics:**

- TX failure → **no** project row, **no** revision row, **no** `asset_objects` insert, **no** `organization_asset_grants` rows for this import.
- FS bytes written before TX failure remain as **orphan files** (no DB row referencing them) → eligible for later GC after lease expiry.
- Leases for the import session are deleted in the same TX on success; on TX failure, leases remain until TTL expiry (§9.2) then GC may collect orphan bytes.

### 4.5 Path safety (contentSha256 → FS)

Before any read/write under `assets/`:

1. Reject sha not matching `/^[0-9a-f]{64}$/`.
2. Resolve with `path.resolve(assetsRoot, sha256)` and require `resolved === path.join(assetsRoot, sha256)` (no `..`, no separators inside sha).
3. **Tests required:** symlink or reparse point under `assetsRoot` pointing outside must not be followed for read/write; open must use resolved path containment check.

### 4.6 Capacity quotas (R1)

| Limit | Value | Enforcement |
|---|---|---|
| Per-asset byte length | 10 MiB | Worker + `asset_objects.byte_length` |
| Per-organization referenced asset bytes | **512 MiB** | Sum `byte_length` for shas referenced by **any durable revision** in org; reject import/save if exceeded |
| Total `R1_DATA_DIR/assets/` store | **2 GiB** | Reject import `putIfAbsent` when global sum would exceed |
| Per-project import ZIP spool | 32 MiB | HTTP stream cap |

Referenced-byte sum for org quota uses revision documents only (not grant rows alone).

## 5. Envelope / contentHash compatibility (P1)

### 5.1 Problem

Unconditionally changing `contentHash` to hash `{document, assetSha256s}` breaks existing V1 revision/snapshot verification. Asset shas already appear inside `AssetRef` fields when schemaVersion includes them — **correct per-version canonicalize of the document is enough**; a parallel manifest is unnecessary.

### 5.2 Rules

| Document `schemaVersion` | Canonicalizer | Existing V1 data |
|---|---|---|
| **1** (current) | **Unchanged** byte-for-byte canonical algorithm used today | Must continue to verify |
| **2+** (assets) | Extend `canonicalizeTarget` to include §6.4 **保持** target fields + `CostumeRef`/`SoundRef` in **stable key order** | N/A for legacy rows |

- Maintain **schemaVersion-dispatched** `canonicalizeDocument(doc)` / `contentHash(doc)`.
- Do **not** introduce a silent second hashing pass that alters V1.
- **Regression tests required:** existing V1 create/save/snapshot/restore/idempotent replay remain green with **identical** `contentHash` expectations for the same V1 fixtures.

### 5.3 Empty projects

**Pinned:** new projects created via `createProject` remain **schemaVersion 1** (no costume arrays). **First SB3 import** mints **schemaVersion 2** with full costume/sound refs. Equivalence tests use import-created projects.

## 6. ProjectDocument shape + Scratch project.json field pin

**Source of truth:** Scratch Editor **v14.1.0** — `packages/scratch-vm/src/serialization/sb3.js` (`serializeTarget`, `serializeCostume`, `serializeSound`, top-level `serialize`) and `deserialize-assets.js` (costume/sound format acceptance).

### 6.1 Discriminated refs

```typescript
type CostumeDataFormat = "svg" | "png" | "jpg" | "bmp" | "gif"
type SoundDataFormat = "wav" | "mp3"

interface CostumeRef {
  kind: "costume"
  name: string
  assetId: string           // 32-char md5 hex
  md5ext: string            // "{assetId}.{canonicalExt}"
  dataFormat: CostumeDataFormat
  contentSha256: string     // 64-char hex
  rotationCenterX: number
  rotationCenterY: number
  bitmapResolution?: number // bitmap costumes only; omit when absent in SB3
}

interface SoundRef {
  kind: "sound"
  name: string
  assetId: string
  md5ext: string
  dataFormat: SoundDataFormat
  contentSha256: string
  rate: number
  sampleCount: number
  format: string            // SB3 "format" field; preserve (often "")
}
```

- Same `md5ext` may appear on **multiple costumes**; **do not** invent uniqueness constraints on `(target, md5ext)`.
- `currentCostume`: integer index into `costumes[]`. **schemaVersion ≥ 2 durable save:** stage and every sprite must have `costumes.length >= 1` and `0 <= currentCostume < costumes.length`.

### 6.2 Format allow-list and canonical aliases

**Costume `dataFormat` (accept on import → store canonical → export canonical ext):**

| Import ext (case-insensitive) | Canonical `dataFormat` | Canonical `md5ext` suffix | Scratch VM asset type |
|---|---|---|---|
| `svg` | `svg` | `.svg` | ImageVector |
| `png` | `png` | `.png` | ImageBitmap |
| `jpg`, `jpeg` | **`jpg`** | **`.jpg`** | ImageBitmap |
| `bmp` | `bmp` | `.bmp` | ImageBitmap |
| `gif` | `gif` | `.gif` | ImageBitmap |

**Sound `dataFormat`:**

| Import ext | Canonical | Suffix |
|---|---|---|
| `wav` | `wav` | `.wav` |
| `mp3` | `mp3` | `.mp3` |

Any other extension → **hard reject**. Sniff may corroborate; declared vs detected mismatch → reject.

### 6.3 Media decode limits (beyond byte length)

| Format | Limit | Verification |
|---|---|---|
| PNG / JPEG / GIF / BMP | Max **4096×4096** pixels; max **16_777_216** pixels | Decode header in worker; reject over limit |
| SVG | Max **512 KiB** text; max **65_536** DOM nodes (elements + text nodes) | `@xmldom/xmldom` parse in worker; reject over limit |
| WAV | Max **60 s** duration; max **176_400_000** samples (44.1 kHz × 60 s × stereo ceiling) | Parse RIFF `fmt` + `data` chunks |
| MP3 | Max **60 s** duration | Frame scan or decode header in worker |

**`rate` / `sampleCount` integrity (sounds):**

- **WAV:** `rate` must equal `fmt.sampleRate`; `sampleCount` must equal sample frames in `data` chunk (exact; mono/stereo accounted).
- **MP3:** compute duration from frames; require `sampleCount === round(durationSeconds * rate)` with tolerance **±1** sample.
- Mismatch → hard reject import and save.

### 6.4 Scratch 3 `project.json` field classification (v14.1.0)

**Top-level**

| Field | Policy | Notes |
|---|---|---|
| `targets` | **保持** | Required array; each target classified below |
| `meta` | **保持** | `semver`, `vm`, `agent`, `origin` preserved in `ProjectDocument.meta` |
| `extensions` | **保持** | Must ⊆ R1 allow-list; extra → reject |
| `monitors` | **明示拒否** | Not in R1 equivalence surface |
| Any other top-level key | **明示拒否** | e.g. unknown future keys |

**Target — common**

| Field | Policy | Notes |
|---|---|---|
| `isStage` | **保持** | |
| `name` | **保持** | Stage name remains `"Stage"` on export |
| `variables` | **保持** | Map id → `[name, value]` or cloud `[name, value, true]` |
| `lists` | **保持** | Map id → `[name, value[]]` |
| `broadcasts` | **保持** | Map id → name string |
| `blocks` | **保持** | Full SB3 block graph |
| `comments` | **明示拒否** | |
| `currentCostume` | **保持** | **正規化:** clamp to `[0, costumes.length-1]` on import (match VM) |
| `costumes` | **保持** | Array of costume objects; see below |
| `sounds` | **保持** | Array of sound objects; see below |
| `volume` | **保持** | Stage and sprites |
| `layerOrder` | **保持** | Serialized layer ordering |
| `scripts` | **明示拒否** | SB2 legacy |
| `targetPaneOrder` | **明示拒否** | Import-only legacy hint |
| Unknown target keys | **明示拒否** | |

**Target — stage only (`isStage: true`)**

| Field | Policy |
|---|---|
| `tempo` | **保持** |
| `videoTransparency` | **保持** |
| `videoState` | **保持** (`on` / `off` / `on-flipped`) |
| `textToSpeechLanguage` | **保持** (nullable) |
| `visible`, `x`, `y`, `size`, `direction`, `draggable`, `rotationStyle` | **明示拒否** if present on stage |

**Target — sprite only (`isStage: false`)**

| Field | Policy |
|---|---|
| `visible` | **保持** |
| `x`, `y` | **保持** |
| `size` | **保持** |
| `direction` | **保持**; **正規化:** wrap/clamp to **[-179, 180]** on import (match VM) |
| `draggable` | **保持** |
| `rotationStyle` | **保持** (`all around` / `left-right` / `don't rotate`) |
| `tempo`, `videoState`, `videoTransparency`, `textToSpeechLanguage` | **明示拒否** if present on sprite |

**Costume object**

| Field | Policy |
|---|---|
| `name` | **保持** |
| `assetId` | **保持** |
| `md5ext` | **保持**; must match `assetId` + canonical suffix |
| `dataFormat` | **正規化** → canonical lowercase (§6.2) |
| `rotationCenterX`, `rotationCenterY` | **保持** |
| `bitmapResolution` | **保持** when present |
| `textLayerMD5`, `textLayerAsset`, `asset` | **明示拒否** (SB2 / upload inline) |
| Unknown keys | **明示拒否** |

**Sound object**

| Field | Policy |
|---|---|
| `name`, `assetId`, `md5ext`, `rate`, `sampleCount` | **保持** |
| `dataFormat` | **正規化** → canonical lowercase |
| `format` | **保持** (legacy string, often `""`) |
| Unknown keys | **明示拒否** |

**Internal `ProjectDocument` mapping:** each SB3 target becomes a `ScratchTarget` with stable `id` (generated on import, preserved on subsequent saves), plus §6.4 **保持** fields on the target record. Blocks remain keyed by block id.

## 7. Untrusted SVG / media (fixed) (P1)

### 7.1 Import safety (worker — hard reject)

| Item | Pinned choice |
|---|---|
| XML/SVG parser | **`@xmldom/xmldom`** — pin exact version from vendor lockfile at implementation time (same major as `scratch-svg-renderer` dependency tree) |
| CSS `url()` / style scan | **`css-tree@3.2.1`** (vendor `scratch-svg-renderer` pin) |
| Regex-only gate | **Forbidden** as sole inspection; regex only as css-tree Raw fallback (same pattern as vendor `sanitize-svg.js`) |
| Policy | **Reject import** on failure (do not store-then-block-display) |

**Reject if any:**

- Disallowed elements: `script`, `foreignObject`, `iframe`, `embed`, `object`, `use` (with external `href`), `animate`/`set`/`handler` linking external URI
- Event attributes: any attribute name matching `/^on/i`
- URI attributes (`href`, `xlink:href`) with scheme other than `#fragment` or `data:` (after whitespace strip)
- CSS in `style` or presentation attributes containing external `url(` (per css-tree walk + Raw fallback)
- `http:`, `https:`, `javascript:` anywhere in href/xlink/href
- Node count or byte limits exceeded (§6.3)

### 7.2 Asset HTTP delivery

All assets including SVG: **`application/octet-stream`** + **`Content-Disposition: attachment`** + **`nosniff`** (§4.3). Never serve inline SVG MIME on same origin.

### 7.3 Host display path (fixed — Task 0 must prove)

1. Host `fetch`es project-scoped asset URL with credentials.
2. Receives **octet-stream** body; holds bytes in memory/`Uint8Array`.
3. Passes bytes to **`runtime.storage.createAsset(AssetType.ImageVector | ImageBitmap | Sound, dataFormat, bytes)`** — the same boundary Scratch VM uses.
4. **Forbidden:** `<img src=".../assets/{sha}">`, `blob:` URL from raw SVG for DOM `<img>`, or opening asset URL in iframe/document for SVG costumes.
5. scratch-svg-renderer sanitization runs inside VM render path on those bytes (vendor behavior).

Task 0 Go criterion **includes** demonstrating steps 1–4 for at least one SVG and one PNG costume.

### 7.4 Worker isolation

ZIP + media parse + SVG inspect run under heap/time-limited worker (`--max-old-space-size` + wall clock). Kill on timeout; delete temps (tested).

## 8. Import / export isolation boundary (P1)

```text
HTTP multipart
  → stream to size-capped temp file (reject before full RAM ZIP)
  → spawn worker (max-old-space-size + wall clock)
       - zip parse, limits, extract entries to worker temp dir
       - md5/sha, format allow-list, SVG safety (§7), audio header checks
       - write verified assets to holding dir
  → parent receives: ImportManifest (JSON) + paths to verified asset files
       - NO giant Map clone over IPC
  → parent: INSERT asset_import_leases (if not already) for manifest shas
  → parent: FS putIfAbsent for each verified file (outside TX)
  → parent: importSb3CreateProjectAtomic TX (§4.4)
  → always: kill worker on timeout; close; delete temps (tested)
```

Export similarly: output size / time / memory caps; worker or bounded assembler; timeout kill + cleanup tests.

## 9. Grant / lease / GC lifecycle (fixed) (P1)

### 9.1 Roles

| Mechanism | Purpose |
|---|---|
| `asset_objects` + FS bytes | Global immutable blob store (content-addressed) |
| `organization_asset_grants` | **Authorization** — org may reference sha in documents / read via project GET |
| `asset_import_leases` | **In-flight protection** — bytes being imported but not yet in revision 0 |
| Revision + snapshot scan | **Reachability** — determines whether bytes are still needed |

**Grants are NOT part of the GC byte reference set.** Putting every grant into the reference set would pin bytes forever after a one-time cross-project reuse.

### 9.2 Import leases (in-flight)

| Event | Behavior |
|---|---|
| Create | After worker manifest validated, before FS put: insert lease rows `(organization_id, sha256, import_session_id, expires_at = now + 15m)` |
| Renew | Optional: extend `expires_at` on worker progress heartbeat (same session) |
| Commit success | Delete all leases for `import_session_id` inside import TX (§4.4) |
| TX rollback / HTTP error | Leases remain until `expires_at` |
| Crash | Leases expire by TTL; expired leases **excluded** from GC reference set |

### 9.3 GC byte reference set

Union of `contentSha256` from:

1. **Every durable project revision** document in SQLite (full history)
2. **Every snapshot** envelope on disk
3. **Active import leases:** `asset_import_leases` where `expires_at > now`

**Not included:** `organization_asset_grants` alone.

### 9.4 Grant revocation

After a successful GC scan identifies globally unreferenced shas:

1. Move FS object to quarantine (§9.6) if not already referenced.
2. Delete **`organization_asset_grants`** rows for that sha (all orgs).
3. Delete **`asset_objects`** row when FS file is quarantine-eligible.

**Project delete / revision discard:** no immediate grant delete in request path; **next GC run** revokes grants for shas no longer referenced by any revision/snapshot/lease. Product may add explicit purge API later; R1 relies on GC.

**Save referencing sha without grant:** reject (§4.2) — prevents “grant forgery” without a live reference chain.

### 9.5 Org quota vs grants

Quota enforcement (§4.6) uses **revision references**, not grant table size. An org cannot grow past quota by accumulating grants without document references.

### 9.6 Quarantine + final delete

| Step | Rule |
|---|---|
| Move | Unreferenced sha → `assets/.quarantine/{sha256}` (atomic rename) |
| Grace | **7 days** minimum retention in quarantine |
| Final delete | Only if: (a) still unreferenced in latest GC scan, (b) grace elapsed, (c) **entire GC scan completed without error** |
| Scan failure | **Abort entire GC** (fail-closed); no deletes; quarantine unchanged |

Document residual risk if quarantine fills disk (operator alert; manual cleanup runbook in Task 11).

## 10. Scratch host — Task 0 spike (P1)

**First candidate:** embed vendor **scratch-gui / scratch-vm / scratch-blocks** from pin `v14.1.0` via the monorepo vendor tree, wrapped by `apps/r1-scratch-host`.

### 10.1 Provisional schema + fixture (Task 0 runs before Task 1)

Task 0 must compare against a **pinned provisional shape**, not wait for `packages/project-schema` Task 1.

| Artifact | Path |
|---|---|
| Provisional TypeScript types | `apps/r1-scratch-host/spike/schema/document-spike-v0.ts` |
| Expected document fixture | `apps/r1-scratch-host/spike/fixtures/cat-with-sound.expected.json` |
| Source SB3 | Vendor-derived minimal project with ≥1 SVG costume + ≥1 WAV (record path in spike doc) |

**Comparison function (`equivalenceSpikeV0`):** deep equality on all §6.4 **保持** fields + costume/sound refs (`assetId`, canonical `dataFormat`, `contentSha256`, `md5ext`, rotation centers, rate/sampleCount/format). Ignore server-assigned target `id` and envelope metadata. Asset bytes compared by `contentSha256` only in spike (HTTP asset store not required for Task 0 if bytes loaded directly into VM — but display path test §7.3 still required).

### 10.2 Task 0 Go / Stop

| Criterion | Go | Stop |
|---|---|---|
| Pin alone embeds workspace + stage | Yes without fork | Need vendor patch → **STOP**; escalate fork/ADR |
| Real costumes/sounds display + run | Yes via §7.3 storage boundary | Cannot without stubbing → Stop |
| Capture block create / delete / connect / field edit | Yes | Stop |
| Rebuild provisional document from VM **without dropping assets** | Matches `cat-with-sound.expected.json` on §6.4 preserve set | Stop |

Until Task 0 Go, Task 10 host completeness may not claim editor Go. Server Tasks 1–9 may proceed in parallel after design Go.

**Conversion responsibility:** Host is the **only** browser component allowed to mutate the editing Document; server never trusts client-supplied asset **bytes** on save (refs + grants only). Import/export machines own bind/unbind of ZIP ↔ (document, assets).

## 11. Package diagram

```text
project-schema          CostumeRef/SoundRef, schemaVersion 2, §6.4 validators
project-envelope        schemaVersion-dispatched canonicalize (V1 frozen)
project-assets-fs       putIfAbsent/get/quarantine; §4.5 path safety
project-store-sqlite    asset_objects + grants + leases + importSb3CreateProjectAtomic
sb3-tools               spool-aware worker; §6.4 canonical I/O; §7 SVG worker
project-service         save/restore grant verify; import calls atomic repo only
r1-persist-server       import/export routes; head-only asset GET; GC
r1-scratch-host         narrow GUI after Task 0 Go
```

## 12. HTTP API (additive)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/projects/import-sb3` | multipart → spool → worker → §4.4 atomic TX |
| `GET` | `/v1/projects/:id/export-sb3` | capped export |
| `GET` | `/v1/projects/:projectId/assets/:sha256` | head-only ref check; §4.3 headers |

No unscoped `/v1/assets/:sha256`. No `acceptWarnings`. No snapshot-scoped asset GET in R1.

## 13. Acceptance matrix (blocking)

Prior equivalence + limits, **plus**:

- Cross-org sha forgery on save/GET → reject
- Import failure → no project/grant/object rows (§4.4); FS orphans only
- Crash between FS write and DB commit → leases TTL → GC can collect orphans; no readable cross-org leak
- Concurrent same-asset import for two orgs → two grants, one object
- Concurrent same-org import → single object + grant
- GC scan failure / corrupt revision → GC aborts; no mass delete
- Unsafe SVG import rejected (§7.1)
- Symlink/reparse escape under `assets/` → rejected in tests
- Org + global disk quota enforced
- WAV/MP3 rate/sampleCount mismatch → reject
- V1 persistence fixture regression (hash stable)
- Host: block add/connect/delete + green flag + §7.3 display path (after Task 0 Go)

## 14. Review checklist

- [x] A + E1 + S1 retained
- [x] Org grants + project-scoped asset URLs (head-only)
- [x] V1 contentHash frozen; V2 schema via document fields
- [x] SVG/media isolation + delivery policy pinned (§7)
- [x] Import atomic TX + import-only repo method (§4.4)
- [x] Lease table + GC reference set without grant pinning (§9)
- [x] Scratch project.json field classification (§6.4)
- [x] dataFormat canonical table + media limits (§6.2–6.3)
- [x] Task 0 provisional schema/fixture (§10.1)
- [x] Quotas (§4.6)

## 15. Next after Go

Paint/sound editors, approval UX for partial imports, monitor round-trip, stronger SVG rewriting (vs reject), explicit grant purge API, Envelope V2 only if needed beyond schemaVersion.
