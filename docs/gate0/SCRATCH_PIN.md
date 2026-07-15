# Scratch Editor Pin (Gate 0)

**Selection date:** 2026-07-15  
**Upstream commit SHA:** `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8`  
**Upstream tag:** `v14.1.0`  
**Fork patch SHA:** none (temporary upstream-direct pin; see ADR-0001)

## Selection rationale (not “latest”)

Candidates considered included `v14.1.0`, `v14.0.0`, and prerelease `v14.2.0-accessibility-fixes-and-costume-updates.1`.

`v14.1.0` was chosen because:

1. It is a named stable release tag (not tip-of-main).
2. Monorepo `.nvmrc` is explicit (`24.16.0`).
3. Vendor source at this SHA builds a usable Node VM bundle for headless Gate 0 tests.
4. License is clearly `AGPL-3.0-only` at the monorepo root and VM package.
5. VM sequencer/thread APIs required for observation and one-block stepping are reachable without modifying vendor sources (runtime wrapping only).

Prerelease 14.2.x tags were deferred until accessibility-driven churn settles for Gate 0 baselines.

## Node / package managers

| Surface | Tool | Version |
|---|---|---|
| This repo (root) | Node | **24.16.0** (from pin `.nvmrc`) |
| This repo | pnpm | 10.33.0 (packageManager field) |
| `vendor/scratch-editor` | npm workspaces | Follow upstream README; **not** part of pnpm workspace |

## Scratch packages used (from pin)

| Package | Role in Gate 0 |
|---|---|
| `@scratch/scratch-vm` 14.1.0 | **Headless runtime** via vendor webpack dist `packages/scratch-vm/dist/node/scratch-vm.js` |
| `@scratch/scratch-gui` | Source present in vendor; not loaded in Gate 0 tests |
| `@scratch/scratch-render` | Built as a vendor dependency of the VM dist; not attached headless |
| `@scratch/scratch-svg-renderer` | Built as a vendor dependency of the VM dist |
| `@scratch/task-herder` | Vendor tooling |

`@blocksync/scratch-adapter` loads only the **vendor-built** `@scratch/scratch-vm@14.1.0` Node bundle. It does **not** use npm `scratch-vm@5.x`. `pnpm gate0:check-pin` requires that dist to exist.

## Upstream diffs applied by this project

**None.** Submodule must stay clean. If a patch is required → stop and request a fork (ADR-0001).

## Initialize / build / test (Windows)

```powershell
# Node 24.16.x recommended (nvm-windows / fnm)
git submodule update --init vendor/scratch-editor
pnpm install --frozen-lockfile

# Required before check-pin / tests: vendor VM dist
pnpm gate0:build-vendor-vm

pnpm gate0:check-pin
pnpm build
pnpm gate0:check-licenses
pnpm gate0:test
pnpm gate0:collab
```

`gate0:build-vendor-vm` runs `npm ci` inside `vendor/scratch-editor` (ignore-scripts) and webpack-builds svg-renderer → render → vm. Outputs under `vendor/**/dist/` are gitignored; CI rebuilds them.

## AGPL source offer posture (technical)

Consumers can obtain the exact Scratch sources via this repository’s `vendor/scratch-editor` gitlink SHA, `.gitmodules` URL, and the build steps above. Legal acceptance of AGPL obligations is a **human** gate tracked separately in `GO_NO_GO.md`.
