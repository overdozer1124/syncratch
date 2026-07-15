# Release 1 Slice — Scratch Editor Surface + Safe SB3 I/O Design

> **Date:** 2026-07-16
> **Status:** Draft for review (do not implement until approved)
> **Baselines:** Gate 0 Technical Go @ `4a14e05`; R1 persistence Technical Go @ `3d6053b`; R1 auth Technical Go — real GIS conditional @ `570e237`
> **Vendor pin:** Scratch Editor `v14.1.0` / `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` (unchanged)
> **Spec anchors:** §6, §10–14, §40, §42–43, §55, §62
> **Prior slice next-step:** Auth design “Scratch editor + safe SB3 I/O wired to persistence APIs”

## 1. Goal

Wire a **narrow Scratch editing surface** and **server-side safe SB3 import/export** to R1 persistence such that:

1. SB3 import creates a **new** project (default) with **full costume/sound byte fidelity**
2. Meaning structure (blocks, variables, lists, broadcasts, targets, …) is durable in `ProjectDocument`
3. Asset **bytes** live in an **immutable content-addressed store** (not JSON embedding)
4. Edit → autosave → process restart → export → re-import preserves **semantic + asset equivalence**
5. **No silent stubbing** of costumes/sounds or other supported/required fields
6. Unsaveable / unsupported material is **import-rejected** or surfaced as **explicit warnings requiring user approval** before continuing

**Out of scope for this slice:** Yjs multiplayer, teacher roles UI, AI, real GIS evidence (remains auth conditional), changing Gate 0 vendor pin, byte-identical SB3 ZIP round-trip, full Scratch website UI parity.

**If capacity pressure arises:** shrink GUI breadth (panels, paint editor, extensions UX) **before** weakening the asset-fidelity contract.

## 2. Equivalence contract (Go condition)

### 2.1 Not required

- Bit-identical SB3 file hashes (ZIP entry order, compression method, central directory layout may differ).

### 2.2 Required (canonical equivalence)

After **import → edit/save (or no-op save) → restart server → export → re-import**, the following must match between the two persisted projects (modulo allowed edit deltas under test control):

| Layer | Must preserve |
|---|---|
| Structure | `targets` (stage/sprites), `blocks` graphs, `variables`, `lists`, `broadcasts`, `extensions` allow-listed subset, layer order / currentCostume indices, sprite transform fields used by Scratch 3 |
| Assets | Every costume/sound **byte sequence** present; no substitution with stubs |
| Asset metadata | `assetId`, `md5ext`, `dataFormat` / format, name, rotation centers / rate/sampleCount as applicable, and **reference integrity** (every md5ext referenced exists; every stored asset is referenced or retained under revision policy) |
| Integrity | SHA-256 of each asset byte blob; md5/`assetId` checks continue to match Scratch conventions on import |

### 2.3 Unsaveable / unknown material policy

| Case | Behavior |
|---|---|
| Malicious / limit-violating ZIP | **Hard reject** (no project created) — reuse/extend Gate 0 `loadSb3Isolated` issues |
| Supported schema + all assets intact | Accept |
| Unknown opcode / disallowed extension / comments / monitors / custom fields that this slice **cannot** store | **Hard reject** *or* return `requiresApproval: true` with machine-readable `warnings[]` / `droppedCandidates[]`; client must send explicit `acceptWarnings=true` (or equivalent) to proceed. **Never** silently drop or stub |
| Costume/sound bytes missing or hash mismatch | **Hard reject** |

R1 implementation default for “cannot store”: **hard reject** until an approval UX exists; optional staged “approval token” API is allowed if tests cover both paths.

## 3. Current state (survey)

```text
Gate 0 sb3-tools:  loadSb3Isolated → ProjectDocument (drops costumes/sounds from schema)
                   exportSb3 → stubs SVG costumes  ❌ forbidden as R1 product contract
project-schema:    targets.blocks/vars only — no costume/sound metadata fields
project-envelope:  contentHash(document) only — no asset set
r1-persist-server: JSON document PUT; body ≤ 2 MiB; no /sb3 routes; FS snapshots for JSON
r1 auth:           Cookie session + CSRF + Origin (google mode)
UI:                no Scratch GUI host in apps/
```

## 4. Approaches compared

### 4.1 Asset storage

| Approach | Idea | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Content-addressed immutable asset store + metadata in ProjectDocument** | Bytes at `assets/{sha256}`; document holds costume/sound meta + `contentSha256` (and Scratch `md5ext`/`assetId`) | No JSON bloat; dedup; GC possible; matches user mandate | Schema + store + importer wiring | **Recommended** |
| B. Base64 embed in `ProjectDocument` | Single blob in envelope | Simple mentally | Breaks body limits; slows canonicalize; couples revision JSON size to media | **Rejected** |
| C. Per-project opaque media directory without content hash | `projects/{id}/media/{md5ext}` | Familiar Scratch layout | Weak dedup; harder CAS across revisions; risk of silent overwrite | **Rejected** as primary (may mirror md5ext names *as aliases* to sha256 objects) |

### 4.2 Editor surface (within asset-fidelity mandate)

| Approach | Idea | Pros | Cons | Verdict |
|---|---|---|---|---|
| **E1. Narrow host + Scratch stage/workspace subset** | Thin React (or Vite) app: project open, sprite list, blocks workspace, stage run; paint/sound editors deferred | Fits capacity; still “edit Scratch” | Not full Scratch GUI | **Recommended for R1 width** |
| E2. Full vendor `scratch-gui` embed | Maximum familiarity | Large AGPL host, packaging, upgrade friction | Optional later |
| E3. Headless-only API slice | Zero GUI | Fails §40/§55 “edit” intent | Rejected as sole deliverable |

**Combined recommendation:** Storage **A** + Editor **E1**. GUI may omit costume paint / sound recorder in R1, but **must not rewrite assets to stubs** on save/export.

### 4.3 SB3 I/O placement

| Approach | Idea | Verdict |
|---|---|---|
| **S1. Server import/export** using `loadSb3Isolated` + asset put + project create; export reassembles ZIP from document + asset store | Keeps isolation at trusted boundary; ACL/auth already present | **Recommended** |
| S2. Browser-only import | Isolation ≠ Node child worker; easier to ship but weaker §13 posture | Rejected as primary |
| S3. Hybrid (server import, client export) | Split truth | Avoid — export must use same store |

## 5. Package / ownership diagram

```text
browser (r1-scratch-host, narrow)
  ├─ session + CSRF cookies (google) or stub headers
  ├─ load envelope + asset URLs/hashes
  └─ autosave → PUT /v1/projects/:id/document

r1-persist-server
  ├─ auth (existing)
  ├─ ProjectService (existing ACL/CAS)
  ├─ Sb3ImportService / Sb3ExportService  (new orchestration)
  ├─ AssetStore port                         (new)
  └─ openSqliteStore + FS assets + FS snapshots

@blocksync/sb3-tools
  ├─ loadSb3Isolated (harden limits + MIME/ext allow-list helpers)
  ├─ importToCanonical(projectJson, assetBytes) → { document, assets[] }  (new, no stubs)
  └─ exportFromCanonical(document, assetBytesBySha) → SB3 ZIP           (new, no stubs)

@blocksync/project-schema
  └─ ProjectDocument vN: target costumes[] / sounds[] metadata (+ comment policy)

@blocksync/project-envelope
  └─ contentHash includes document + sorted assetSha256 set (or documented companion field)

@blocksync/project-assets-fs (or project-store-sqlite helper)
  └─ putIfAbsent(sha256, bytes); get; listKeys; gcOrphans(referenced)
```

**Acyclic rule:** `project-schema` has no asset bytes; `sb3-tools` may depend on schema; `project-service` depends on AssetStore port, not on ZIP libraries if possible (orchestration in server or thin `project-sb3` package). Prefer thin `apps/r1-persist-server` orchestration calling packages.

## 6. Data model

### 6.1 ProjectDocument (proposed fields)

Extend `ScratchTarget` (schema bump `schemaVersion`):

```typescript
interface AssetRef {
  name: string
  assetId: string          // Scratch md5 hex of bytes (as in SB3)
  md5ext: string           // e.g. "<assetId>.svg"
  dataFormat: string       // svg | png | bitmap | wav | mp3 | ...
  contentSha256: string    // server canonical address (hex)
  // costume-only:
  rotationCenterX?: number
  rotationCenterY?: number
  bitmapResolution?: number
  // sound-only:
  rate?: number
  sampleCount?: number
}

interface ScratchTarget {
  // existing block/var fields…
  costumes: AssetRef[]
  sounds: AssetRef[]
  currentCostume: number
  // sprite transform / stage fields needed for equivalence (explicit allow-list in plan)
}
```

**Binaries never appear in ProjectDocument JSON.**

### 6.2 Immutable asset store

```text
R1_DATA_DIR/assets/{sha256hex}     # raw bytes, write-once
```

- `putIfAbsent`: if exists, verify byte equality (mismatch → hard error)
- Referenced set = union of all `contentSha256` in head + snapshot envelopes kept durable
- Startup GC: delete unreferenced asset files (like snapshot orphan GC)
- Optional SQLite index `assets(sha256 PK, byte_length, created_at)` for listing — not required if FS enumerate is enough for R1

### 6.3 Revision / envelope hashing

`ProjectEnvelopeV1.contentHash` becomes hash of canonical JSON of:

```text
{ document, assetSha256s: sorted unique contentSha256[] }
```

or keep `contentHash` on document-only **and** add mandatory `assetManifestHash` — **prefer single combined hash** to avoid split-brain saves.

Snapshots remain atomic FS objects of the **envelope JSON** (still no embed of asset bytes). Snapshot restore must leave assets intact (assets are immutable and shared).

### 6.4 SQLite

Minimal additions (if needed): none beyond existing project tables if asset refs live only inside envelope JSON. Optional `asset_objects` table for ops. Prefer **FS-only assets** for R1 to match snapshots-fs pattern.

## 7. SB3 importer / exporter boundary

### 7.1 Import pipeline (server)

1. Auth + CSRF + Origin (google) / stub headers
2. Body size ≤ configured max (raise dedicated multipart limit separately from 2 MiB JSON limit)
3. `loadSb3Isolated(bytes, limits)` — ZIP path/depth/ratio/entry counts/uncompressed
4. **Additional server checks:** extension allow-list for entry names; MIME sniff where feasible; reject double extensions / unexpected types
5. Map Scratch `project.json` → `ProjectDocument` **including** costume/sound metadata; extract bytes; compute `contentSha256`; verify Scratch `assetId` md5
6. Unsupported → hard reject (default) with issue codes
7. `AssetStore.putIfAbsent` for each asset
8. `createProject` + initial revision envelope (combined hash)
9. Response: `{ projectId, revision, warnings[] }`

### 7.2 Export pipeline (server)

1. Auth + ACL
2. Load head envelope; gather `contentSha256` set; `AssetStore.get` each
3. Build Scratch `project.json` from document metadata (use stored `md5ext` / `assetId`)
4. ZIP assemble with **real** asset bytes (deterministic entry order recommended for tests, not for users)
5. Compatibility label from §14 (R1: “完全互換候補” only when only allow-listed standard elements)

### 7.3 Forbidden

- Calling today’s `exportSb3(document)` stub implementation on the product path
- Writing placeholder SVG when source bytes exist
- Stripping costumes on `projectJsonToDocument` without failing

## 8. Scratch editor integration boundary

### 8.1 Host app (`apps/r1-scratch-host` or similar)

Responsibilities:

- Bootstrap auth (stub or google cookies)
- Open project: `GET /v1/projects/:id` + fetch any asset needed for VM/GUI via `GET /v1/assets/:sha256` (authz: must be referenced by a project the caller can read — prevent open asset enumeration)
- Map `ProjectDocument` ↔ Scratch VM / Blockly workspace **without** inventing stub media
- Local edits → `createAutosaveController` → `PUT .../document` with CSRF
- Import/export UX calls server SB3 endpoints (file picker upload / download)

Non-responsibilities:

- ZIP inflate of untrusted SB3 in the browser (primary path is server)
- Mutual TLS of assets without project ACL check
- Patching vendor Scratch submodule (ADR-0001 — fork only if forced; prefer adapter)

### 8.2 VM / GUI

- Prefer loading assets from authenticated asset URLs or in-memory blobs from host
- Stage run may reuse Gate 0 `scratch-adapter` patterns or vendor GUI stage — design allows either if equivalence tests pass
- Deferred: costume paint editor, sound editor, backpack, extensions gallery

## 9. HTTP API (additive)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/projects/import-sb3` | multipart `file`; optional `acceptWarnings` |
| `GET` | `/v1/projects/:id/export-sb3` | returns `application/x.scratch.sb3` or `application/zip` |
| `GET` | `/v1/assets/:sha256` | authorized if sha referenced by accessible project head/snapshot |
| existing | document/snapshot routes | continue; body remains JSON-without-bytes |

Limits: document JSON limit stays tight; SB3 multipart uses higher dedicated caps aligned with `Sb3SafetyLimits`.

## 10. Security / limits

Inherit Gate 0 ZIP guards. R1 server also enforces:

- Absolute/relative path + depth
- Entry count / uncompressed / ratio / maxBytes
- Allow-listed asset extensions (e.g. `.svg`, `.png`, `.wav`, `.mp3` — exact list pinned in plan)
- Do not trust `Content-Type` alone; sniff + extension + size
- Org ACL on all import/export/asset reads
- Never log SB3 bytes, cookies, or ID tokens

SVG/media **safe decode** (§13): R1 minimum = hash + size + format allow-list; full sanitizer may be “best effort / follow-up” but must not block Go if hashes + limits hold — document residual risk in GO_NO_GO.

## 11. Acceptance / verification matrix

### 11.1 Fixture (blocking Technical Go)

- Import corporeal SB3 (stage + sprite + ≥1 costume + ≥1 sound) → assets on disk under sha256; document metadata complete
- Export → re-import → semantic+asset equivalence helper `assertCanonicalEquivalent(a, b)`
- Restart persist process → export still equivalent
- Edit block opcode/value → save → reload → preserved; assets unchanged if unused by edit
- Missing asset / hash mismatch → import 4xx with issue code
- Attempted stub export path unused (regression test that product export ≠ Gate0 stub SVG)
- Limits: oversize ZIP / path traversal rejected
- Unknown unstoreable field → reject (or approval path tested)
- Two-org BOLA: cannot read other’s assets by sha guessing (404/403)
- Auth: google mode CSRF+Origin on import; stub mode headers for fixture

### 11.2 Editor smoke (blocking if E1 in scope)

- Open imported project in host; run green flag; autosave; reload page; project still runs with same costumes/sounds

### 11.3 Real GIS

Unchanged — not required for this slice’s Technical Go wording unless editor mandates google-only; stub auth allowed for fixture Go.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Schema migration breaks existing R1 projects | Version bump; migrate empty-costume documents only in test fixtures; production data still stub-era experimental |
| Large assets fill disk | Quotas per org later; R1: hard limits + GC |
| GUI narrowness alleged incomplete | Document deferred panels; fidelity contract explicit |
| md5 vs sha256 confusion | Store both; address store by sha256 only |

## 13. Review checklist

- [ ] Approach A (asset store) + E1 (narrow editor) + S1 (server SB3) approved
- [ ] No silent costume/sound stubbing on product path
- [ ] Equivalence ≠ ZIP bytes
- [ ] Importer/exporter owns bind/unbind of document ↔ assets
- [ ] Persist envelope hash includes asset set
- [ ] Acceptance §11.1 required for Go

## 14. Next after Go

Broader Scratch GUI (paint/sound), stronger SVG sanitizer, per-org quotas, optional import-into-existing-project with explicit opt-in.
