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
3. Published npm package `@scratch/scratch-vm@14.1.0` matches the monorepo package version at this commit, enabling headless Gate 0 runtime tests without requiring a full GUI monorepo build on every developer machine.
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
| `@scratch/scratch-vm` 14.1.0 | Source in vendor; published node bundle not used for Gate 0 headless tests (see INTERNAL_API_DEPS) |
| `scratch-vm` 5.0.300 | Headless Gate 0 observe/step/parity runtime (CJS) |
| `@scratch/scratch-gui` | Source present in vendor; not loaded in Gate 0 tests |
| `@scratch/scratch-render` | Vendor source; not loaded headless |
| `@scratch/scratch-svg-renderer` | Vendor source |
| `@scratch/task-herder` | Vendor tooling |

Runtime dependency for `@blocksync/scratch-adapter` headless tests is `scratch-vm@5.0.300` (CJS). The AGPL source pin remains `vendor/scratch-editor` at the SHA above; Release 1 should switch to a vendor-built `@scratch/scratch-vm@14.1.0` once the published Node bundle issues are resolved.

## Upstream diffs applied by this project

**None.** Submodule must stay clean. If a patch is required → stop and request a fork (ADR-0001).

## Initialize / build / test (Windows)

```powershell
# Node 24.16.x recommended (nvm-windows / fnm)
git submodule update --init vendor/scratch-editor
pnpm install --frozen-lockfile
pnpm gate0:check-pin
pnpm gate0:check-licenses
pnpm gate0:test
pnpm gate0:collab
```

Optional vendor full build (not required for Gate 0 package unit tests):

```powershell
cd vendor\scratch-editor
nvm use   # or install Node from .nvmrc
npm ci
npm run build
```

## AGPL source offer posture (technical)

Consumers can obtain the exact Scratch sources via this repository’s `vendor/scratch-editor` gitlink SHA, `.gitmodules` URL, and the build steps above. Legal acceptance of AGPL obligations is a **human** gate tracked separately in `GO_NO_GO.md`.
