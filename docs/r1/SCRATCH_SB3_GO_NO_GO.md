# R1 Scratch SB3 I/O + Narrow Host — Go / No-Go

**Date:** 2026-07-17  
**Verdict:** **Technical Go**  
**Design / Plan baseline:** `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md` / `docs/superpowers/plans/2026-07-16-r1-scratch-sb3-plan.md`  
**Task 11 approval base (pre-docs):** `bfc4ba617efa74686fb4ddf456860751039fcb44`  
**Implementation HEAD:** tip of this branch after `docs(r1): Scratch SB3 runbook and Go`

Gate 0 Technical Go, R1 persistence Technical Go, and R1 auth Technical Go baselines are unchanged.

## Scope approved

| Item | Status |
|---|---|
| Enumerated 208-opcode allow-list + generator (`sb3:opcodes:check`) | **Go** |
| Exact opcode membership; `motion_unknown` reject (no prefix) | **Go** |
| Empty `comments`/`monitors` OK; non-empty / block comment reject | **Go** |
| V1 envelope hash frozen; V2 canonicalize includes mutation | **Go** |
| Asset CAS + path safety (lstat/realpath/no-follow) | **Go** |
| Global 2 GiB disk reservations (IMMEDIATE; no double-count) | **Go** |
| SB3 import/export HTTP + isolated worker + head-only asset GET | **Go** |
| GC quarantining TX + boot reconcile | **Go** |
| `equivalenceProduction` multiset fingerprints (§6.7) | **Go** |
| SVG xmldom parse-only + explicit DOM walk; `data:` reject | **Go** |
| Narrow Scratch host after spike Go (§7.3 + autosave) | **Go** |
| Full Scratch GUI Persist E2E / paint-sound editors | Out of scope |
| Non-empty comments/monitors round-trip; hardware extensions | Out of scope (design §15) |

## Reproduce

```text
pnpm sb3:opcodes:check
pnpm build
pnpm gate0:test
pnpm r1:persist:test
pnpm r1:auth:test
pnpm r1:scratch:test
```

## Fixture evidence pointers

| Evidence | Where |
|---|---|
| Opcode artifact / generator | `packages/sb3-tools/vendor/scratch-opcodes-v14.1.0.json`, `scripts/generate-scratch-opcodes.mjs` |
| Schema exact set + negatives | `packages/project-schema` |
| Global disk / GC / atomic import | `packages/project-store-sqlite` |
| SB3 IO + SVG + equivalence | `packages/sb3-tools` |
| Parallel 32 MiB / timeout / crash / TTL | `apps/r1-persist-server/src/sb3-http.test.ts` |
| GC reconcile orchestrator | `apps/r1-persist-server/src/gc.ts`, `gc.test.ts` |
| Narrow host integration | `apps/r1-scratch-host/src/narrow-host.integration.test.ts` |
| Task 0 spike | `docs/r1/SCRATCH_SPIKE.md` |
| Runbook | `docs/r1/SCRATCH_SB3.md` |

## Notes

- Cursor-internal review GO on Tasks 0–10 is the approval trail for this slice; Task 11 closes docs + final gates.
- `r1-persist-server` declares a direct `better-sqlite3@^12.11.1` dependency (used by boot reconcile / GC tests); matches `@blocksync/project-store-sqlite`.
- Auth real-GIS promotion remains conditional per `docs/r1/AUTH_GO_NO_GO.md`.
