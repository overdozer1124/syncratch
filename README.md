# Syncratch（シンクラッチ）

Local-first Scratch collaboration editor. Earlier design notes may still say
BlockSync; the product name is **Syncratch**. Package APIs under `@blocksync/*`
remain the internal npm scope for now and are **@experimental**.

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

On Unix-like shells, the same `pnpm` commands apply after `git submodule update --init vendor/scratch-editor` and `pnpm install`.
