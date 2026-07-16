# R1 Scratch Integration Spike — Task 0 evidence

**Date:** 2026-07-16  
**Verdict:** **Ready for re-review** (P1 corrections applied; prior No-Go in `SCRATCH_TASK0_REVIEW.md`)  
**Design baseline SHA:** `c80734fc2c63f0ff8081ca492fb827de8e781792`  
**Vendor pin:** Scratch Editor `v14.1.0` / `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8`  
**Vendor submodule patch:** none (dist-only builds via root scripts)

## Go criteria (Design §10.2)

| Criterion | Evidence | Status |
|---|---|---|
| Vendor VM loads without submodule patch | `VENDOR_VM_DIST` exists; `createAdapter().runtimeSource` pins `@scratch/scratch-vm@14.1.0` | **PASS** |
| §7.3 display path: bytes → `storage.createAsset` | `attachAssetBytes` + costume/sound `asset.data` is `Uint8Array` | **PASS** |
| Block create / connect / input edit / delete | VM `blocks.createBlock`, parent/next wiring, input mutation, `deleteBlock`, `toJSON` | **PASS** |
| `equivalenceSpikeV0` UID-independent multiset fingerprints (§6.7) | `block-graph-canonical.ts`; UID-regeneration + negative tests; cat/custom round-trip | **PASS** |
| `saveProjectSb3` → fresh VM re-import | `roundTripDocument` (VM A save → VM B load); `materialize-from-sb3-zip.ts` for headless costume bytes | **PASS** |
| Custom procedure full `mutation` preserved | All `PROCEDURE_MUTATION_KEYS` asserted after round-trip | **PASS** |
| scratch-gui standalone bundle required (no skip) | Missing `scratch-gui-standalone.js` fails test; gate builds GUI from clean dist | **PASS** |
| §7.3 browser smoke (minimal) | Playwright: standalone GUI mount, orange costume pixels via renderer, GUI VM block smoke | **PASS** |
| Host typecheck in gate | `pnpm r1:scratch:typecheck` runs before tests | **PASS** |

**Stop triggers not hit:** no vendor source edits; no fork/ADR escalation required.

## Reproduce (clean GUI dist)

```text
# optional: prove gate builds GUI from empty dist
Remove-Item -Recurse -Force vendor/scratch-editor/packages/scratch-gui/dist

pnpm r1:scratch:test
```

Expected:

- `pnpm r1:scratch:typecheck` — PASS  
- Vitest — **19/19** (`spike.test.ts` 9 + `equivalence-spike-v0.test.ts` 10)  
- Playwright — **1/1** (`browser-smoke.spec.ts`)  
- `write-fixtures` — regenerates committed JSON + browser fixtures from VM first-load baseline  

## Artifacts

| Path | Role |
|---|---|
| `apps/r1-scratch-host/spike/block-graph-canonical.ts` | UID-independent script fingerprints (§6.7) |
| `apps/r1-scratch-host/spike/equivalence-spike-v0.ts` | Target + multiset equivalence |
| `apps/r1-scratch-host/spike/sb3-round-trip.ts` | VM A → `saveProjectSb3` → VM B |
| `apps/r1-scratch-host/spike/materialize-runtime-assets.ts` | Pre-save costume/sound byte attach |
| `apps/r1-scratch-host/spike/materialize-from-sb3-zip.ts` | Post–SB3-load byte restore (headless) |
| `apps/r1-scratch-host/spike/storage-bytes.ts` | §7.3 asset attach helper |
| `apps/r1-scratch-host/spike/browser/` | Static host + bootstrap + fixtures |
| `apps/r1-scratch-host/spike/browser-smoke.spec.ts` | Playwright §7.3 smoke |
| `scripts/build-vendor-scratch-gui-spike.mjs` | GUI standalone dist builder (no vendor patch) |

## Notes

- Headless Node VM warns when no renderer/audio engine is attached; round-trip costume equivalence uses ZIP byte re-attach after SB3 import (`materialize-from-sb3-zip.ts`).
- Browser smoke samples orange cat pixels via `renderer.extractColor()` (WebGL stage), not 2D canvas readback.
- VM normalizes sprite `layerOrder` to runtime order (0 for first sprite); expected fixtures match post-load VM state.
- Do **not** start Task 1 until re-review approves this evidence.

## Next

Re-review against `docs/r1/SCRATCH_TASK0_REVIEW.md`. On approval, proceed with **Task 1** (schema + opcode artifact generator).
