# R1 Scratch SB3 I/O + Narrow Host Runbook

Experimental slice: tenant-scoped content-addressed assets, hard-reject SB3 import/export, enumerated opcode allow-list, global disk reservations, GC quarantining, and a narrow Scratch host after Task 0 spike Go.

**Design:** `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md`  
**Plan:** `docs/superpowers/plans/2026-07-16-r1-scratch-sb3-plan.md`  
**Technical Go:** `docs/r1/SCRATCH_SB3_GO_NO_GO.md`  
**Task 0 spike evidence:** `docs/r1/SCRATCH_SPIKE.md`

Gate 0 / R1 persistence / R1 auth Technical Go baselines are unchanged.

## Stack

| Layer | Package / app |
|---|---|
| Opcode allow-list (208) | `scripts/generate-scratch-opcodes.mjs` → `packages/sb3-tools/vendor/scratch-opcodes-v14.1.0.json` |
| Schema / validators | `@blocksync/project-schema` |
| Envelope V1 frozen / V2 mutation | `@blocksync/project-envelope` |
| Asset FS (CAS + quarantine) | `@blocksync/project-assets-fs` |
| SQLite assets / leases / global disk / GC | `@blocksync/project-store-sqlite` |
| Isolated SB3 worker + SVG sanitize | `@blocksync/sb3-tools` |
| Live verify + atomic import | `@blocksync/project-service` |
| HTTP + GC reconcile | `@blocksync/r1-persist-server` |
| Narrow host | `@blocksync/r1-scratch-host` |

**Vendor pin:** Scratch Editor `v14.1.0` / `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8`

## Data directory

```bash
export R1_DATA_DIR=./apps/r1-persist-server/data
pnpm --filter @blocksync/r1-persist-server start
```

Layout (under `R1_DATA_DIR`):

| Path | Role |
|---|---|
| `projects.sqlite` | projects, members, assets, grants, leases, global disk reservations, `gc_state` |
| `snapshots/` | immutable snapshot blobs |
| `assets/live/` | content-addressed live objects (`sha256`) |
| `assets/quarantine/` | GC quarantine objects |
| `import-spool/` | multipart SB3 spool (session dirs) |
| `import-holding/` | holding area before CAS put |
| `worker-temp/` | isolated worker scratch |

Boot: `bootstrapPersistRuntime` → `reconcilePersistBoot` recovers mid-flight GC / expired global reservations / snapshot orphans.

## HTTP (additive)

Auth headers follow `docs/r1/AUTH.md` / `docs/r1/PERSISTENCE.md` (stub: `x-user-id`).

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/projects/import` | multipart SB3; **global disk reservation before spool**; worker + atomic create |
| `GET` | `/v1/projects/:id/export.sb3` | head document → SB3 zip |
| `GET` | `/v1/projects/:id/assets/:sha256` | **head-only** live asset bytes (404 if not referenced / quarantining) |
| `GET`/`PUT` | `/v1/projects/:id` / `.../document` | existing persistence paths |

Import rejects: unknown opcode (exact set — no prefix), non-empty `comments`/`monitors`, block `comment`, unsafe SVG/`data:`, global 2 GiB / org quota exceeded, quarantining referenced assets on later saves.

Global disk cap: **2 GiB** (`GLOBAL_DISK_BYTES`). Parallel near-cap uploads are race-safe via `BEGIN IMMEDIATE` reservations.

## Narrow Scratch host

Production sources under `apps/r1-scratch-host/src/` (spike/ remains regression):

| Module | Role |
|---|---|
| `persist-client.ts` | Persist HTTP client (injectable `fetch`) |
| `document-bridge.ts` | document ↔ VM; `loadProject(object)` (not JSON string) |
| `persist-storage.ts` | §7.3: asset GET → `storage.createAsset` |
| `autosave-host.ts` | generation-aware autosave + `crypto.randomUUID` |
| `index.ts` | `openProjectSession` (+ `dispose`) |

Intentional limits: no full GUI / Playwright Persist E2E; reload proven via Persist GET; block edits in integration tests are hat-only.

## Opcode artifact

```bash
# regenerate (maintenance)
node scripts/generate-scratch-opcodes.mjs

# CI / gate (check only)
pnpm sb3:opcodes:check
```

Expected: 208 opcodes; `--check` fails on drift from vendor pin.

## Final gates

```bash
pnpm sb3:opcodes:check
pnpm build
pnpm gate0:test
pnpm r1:persist:test
pnpm r1:auth:test
pnpm r1:scratch:test
```

| Script | Covers |
|---|---|
| `sb3:opcodes:check` | Enumerated allow-list vs vendor |
| `build` | packages + gate0-collab-server |
| `gate0:test` | Gate 0 packages / demos |
| `r1:persist:test` | persistence + store + persist-server (incl. SB3 HTTP / GC) |
| `r1:auth:test` | session + auth routes |
| `r1:scratch:test` | typecheck + vendor VM/GUI build + Vitest + Playwright spike smoke |

## Related docs

| Doc | Role |
|---|---|
| `docs/r1/PERSISTENCE.md` | Save / snapshot / sync TX |
| `docs/r1/AUTH.md` | Stub / google session |
| `docs/r1/SCRATCH_SPIKE.md` | Task 0 Go evidence |
| `docs/r1/SCRATCH_SB3_GO_NO_GO.md` | This slice Technical Go |
