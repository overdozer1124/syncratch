# BlockSync AI — Gate 0 lab

Experimental monorepo for Gate 0 technical viability checks only. Package APIs are **@experimental** and will not be treated as Release 1 stable.

See:

- [Gate 0 design](docs/superpowers/specs/2026-07-15-gate0-design.md)
- [Implementation plan](docs/superpowers/plans/2026-07-15-gate0-implementation.md)
- [SCRATCH_PIN](docs/gate0/SCRATCH_PIN.md)
- [GO_NO_GO](docs/gate0/GO_NO_GO.md)

## Quick start (Windows)

```powershell
git submodule update --init vendor/scratch-editor
pnpm install
pnpm gate0:check-pin
pnpm gate0:test
pnpm gate0:collab
```

Node version: see `.nvmrc` (must match Scratch pin).
