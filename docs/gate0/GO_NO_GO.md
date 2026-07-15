# Gate 0 Go / No-Go

**Date:** 2026-07-15  
**Pin:** `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` (`v14.1.0`)

## Legend

- **Go** — automated tests + required docs complete
- **条件付き合格 (conditional)** — technical path ready; external/manual item open; **not** counted toward Release 1 auth completion
- **No-Go** — blocking failure or stop condition
- **別トラック** — human/legal track outside this repo’s automated Gate 0

## Results

| Item | Status | Evidence |
|---|---|---|
| Scratch SHA pin + clean submodule | **Go** | `pnpm gate0:check-pin` |
| License inventory | **Go** | `LICENSE_INVENTORY.md` + `pnpm gate0:check-licenses` |
| SB3 corpus round-trip | **Go** | `@blocksync/sb3-tools` tests + `SB3_CORPUS.md` |
| VM observe | **Go** | `scratch-adapter` `test:observe` (runtime: `scratch-vm@5.0.300`; source pin v14.1.0) |
| Visual 1-block step (minimal opcodes) | **Go** | `test:step` |
| Run vs step parity | **Go** | `test:parity` |
| Structure invariants (`project-schema`) | **Go** | package tests |
| Yjs different-sprite sync over WebSocket | **Go** | `pnpm gate0:collab` |
| Google ID token verifier (fixtures) | **Go** | `google-identity` tests |
| Real Google GIS browser login | **条件付き合格** | Not run — `GOOGLE_CLIENT_ID` unset |
| Real Workspace `hd` check | **条件付き合格** | Requires Workspace account smoke |
| Vendor-built `@scratch/scratch-vm@14.1.0` headless | **条件付き合格** | Published node bundle broken here; classic `scratch-vm@5` used for Gate 0. R1 should vendor-build. |
| AGPL / source offer legal acceptance | **別トラック** | Technical offer in `SCRATCH_PIN.md` |
| School data-processing responsibility split | **別トラック** | Spec §54 human gate |

## Conditional pass — Release 1 auth prerequisites

1. Set `GOOGLE_CLIENT_ID` (OAuth client id; not a client secret).
2. Run manual GIS smoke; record in `docs/gate0/evidence/` without storing tokens.
3. Verify `hd` with Workspace and non-Workspace accounts.
4. Promote those rows to **Go**.

## Overall technical Gate 0 verdict

**Technical Go (auth + vendor-vm-bundle conditional).**

Automated Gate 0 packages and WebSocket collab pass. Real Google login and Workspace `hd` remain conditional. Switching headless runtime to vendor-built `@scratch/scratch-vm@14.1.0` is an R1 engineering task (no vendor source patch required for Gate 0).
