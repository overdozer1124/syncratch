# R1 Scratch Editor + Safe SB3 I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant-scoped content-addressed assets, V1-hash-stable envelopes, hard-reject SB3 import/export with isolated spool/workers, enumerated opcode allow-list, global disk reservations, and a narrow Scratch host **after** Task 0 spike Go.

**Architecture:** Design `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md` (revision post-`49d9630`).

**Tech Stack:** TypeScript, pnpm, Vitest, Playwright (host), better-sqlite3, Hono, vendor Scratch `v14.1.0` / `7c172e…`, `@xmldom/xmldom@0.8.10`, `css-tree@3.2.1`.

## Global Constraints

- **Do not implement until revised design is approved**
- Opcode validation: **exact set** from `scratch-opcodes-v14.1.0.json` — **no prefix rules**
- Global 2 GiB: **`global_disk_reservations` + BEGIN IMMEDIATE before spool** — not measure-then-write
- Empty `comments: {}` / `monitors: []` OK; non-empty reject; block `comment` reject
- Preserve block `mutation`; equivalence = **multiset** graph fingerprints (§6.7)
- Import: `importSb3CreateProjectAtomic` only
- SVG: xmldom parse-only; **explicit DOM walk** is authoritative sanitizer
- UTF-8-safe tooling for docs

## File map

| Path | Responsibility |
|---|---|
| `scripts/generate-scratch-opcodes.mjs` | Generate §6.6 opcode artifact from vendor pin |
| `packages/sb3-tools/vendor/scratch-opcodes-v14.1.0.json` | Pinned 208-opcode allow-list |
| `packages/project-schema` | §6.4–§6.6 validators (exact opcode set) |
| `packages/project-envelope` | V1 frozen; V2 canonicalize mutation + pose + assets |
| `packages/project-assets-fs` | put/get/quarantine; §4.5 lstat/realpath/no-follow |
| `packages/project-store-sqlite` | objects+grants+leases+org quota+**global disk reservations**+gc_state |
| `packages/sb3-tools` | worker; equivalenceProduction; SVG explicit walk + fuzz fixtures |
| `packages/project-service` | verify live assets; atomic import |
| `apps/r1-persist-server` | routes; GC §9.4; reconcile §9.7; global reservation before spool |
| `apps/r1-scratch-host` | after Task 0 Go |

---

### Task 0: Scratch integration spike (Go / Stop)

**Go criteria:** unchanged from prior plan + custom procedure mutation + §7.3 display + **`equivalenceSpikeV0` multiset fingerprints** (§6.7).

- [ ] **Step 1–4:** Spike + fixtures + Go/Stop doc + commit

---

### Task 1: Schema + opcode artifact generator

**Files:** `packages/project-schema/**`, `scripts/generate-scratch-opcodes.mjs`, `packages/sb3-tools/vendor/scratch-opcodes-v14.1.0.json`

- Implement generator per Design §6.6.1 (vendor pin `7c172e…`)
- Commit generated JSON; add `pnpm sb3:opcodes:check`
- Validators: exact opcode membership; extension id subset; reject `motion_unknown`
- `ScratchBlock.mutation`; empty comments/monitors policy; duplicate sprite name reject

- [ ] **Step 1: Failing tests** — corpus opcodes ⊆ artifact; `motion_unknown` fails
- [ ] **Step 2: Generator + schema**
- [ ] **Step 3: PASS; commit** `feat(project-schema): enumerated Scratch opcode allow-list`

---

### Task 2: Envelope — V2 includes mutation

- [ ] **Step 1–3; commit** `feat(project-envelope): schemaVersion-dispatched canonicalize with mutation`

---

### Task 3: V1 persistence regression

- [ ] **Step 1–3; commit** `test(r1): freeze V1 envelope hash persistence regression`

---

### Task 4: `project-assets-fs` + path safety

- [ ] **Step 1–3; commit** `feat(project-assets-fs): safe paths and quarantine helpers`

---

### Task 5: SQLite — assets, leases, org quota, global disk reservations, gc_state

```typescript
createGlobalDiskReservation(importSessionId, reservedBytes): void // BEGIN IMMEDIATE
materializeGlobalDiskReservation(importSessionId, deltaBytes): void
releaseGlobalDiskReservation(importSessionId): void
createImportLeases(...): void
createQuotaReservation(...): void
importSb3CreateProjectAtomic(...): ProjectHead // releases org + global reservations
```

- CHECK: `sha256 = lower(sha256)`, `md5_hex = lower(md5_hex)`
- Tests: reservation prevents parallel over-cap; materialized_bytes no double-count

- [ ] **Step 1–3; commit** `feat(project-store): global disk reservations and asset tables`

---

### Task 6: project-service — verify live assets + atomic import

- [ ] **Step 1–3; commit** `feat(project-service): live asset verify and atomic import`

---

### Task 7: sb3-tools — canonical I/O, SVG explicit walk, equivalenceProduction

- Load `scratch-opcodes-v14.1.0.json` for import/export validation
- SVG: `@xmldom/xmldom@0.8.10` parse + **explicit DOM walk** (not parser-as-sanitizer); fuzz fixtures
- **`equivalenceProduction`**: §6.7 target pairing + **multiset** script-root fingerprints
- Audio corpus; procedure mutation fixtures

- [ ] **Step 1–3; commit** `feat(sb3-tools): canonical SB3 IO opcode set and equivalence`

---

### Task 8: HTTP import / export / head-only asset GET

Import order:

1. **`createGlobalDiskReservation` (IMMEDIATE) before spool write**
2. Stream spool; update `materialized_bytes`
3. Worker + manifest; extend reservation for new CAS bytes
4. Leases + org quota reservation
5. FS putIfAbsent; materialize
6. `importSb3CreateProjectAtomic` — release all reservations

**HTTP tests (required):**

- Parallel two **32 MiB** uploads near 2 GiB cap — second rejects
- Worker timeout → reservation released
- Simulated crash + boot reconcile → expired reservation removed
- Reservation + on-disk bytes never double-count

- [ ] **Step 1–3; commit** `feat(r1-persist-server): SB3 import with global disk reservations`

---

### Task 9: GC — quarantining TX + reconcile

- [ ] **Step 1–3; commit** `feat(r1-persist-server): GC quarantining state machine and reconcile`

---

### Task 10: Narrow Scratch host (if Task 0 = Go)

- [ ] **Step 1–3; commit** `feat(r1-scratch-host): narrow editor after spike Go`

---

### Task 11: Docs + scripts + final gates

```text
pnpm sb3:opcodes:check
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
| §6.6 enumerated opcodes + generator | 1, 7 |
| `motion_unknown` negative test | 1, 7 |
| Global disk reservations (§4.6.2) | 5, 8 |
| Parallel 32 MiB / timeout / crash / TTL tests | 8 |
| Multiset equivalence (§6.7) | 0, 7, 10 |
| xmldom parse-only + DOM walk + fuzz | 7 |
| `sha256 = lower(sha256)` CHECK | 5 |
| GC quarantining + reconcile | 9 |

## Execution gate

**Do not implement until revised design is approved.**
