# ADR-0001: Temporary upstream-direct Scratch submodule pin

## Status

Accepted for Gate 0 (2026-07-15). Re-evaluate before Release 1.

## Context

Gate 0 requires a fixed Scratch Editor commit, clean submodule, and AGPL-reproducible sources. A project-owned fork is desirable for future patches, but no fork URL exists yet and Gate 0 forbids dirty local submodule edits.

## Decision

Pin `vendor/scratch-editor` directly to `https://github.com/scratchfoundation/scratch-editor.git` at SHA `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` (`v14.1.0`). Do not track a branch.

## Consequences

- Pros: Simple; exact SHA; no fork admin delay.
- Cons: Cannot land BlockSync patches without stopping to create a fork.

## Fork migration conditions

Stop and migrate to a project fork when any of:

1. A Scratch source change is required for Gate 0/R1 viability.
2. Release engineering requires origin control (protected branches, CI on fork).
3. Upstream force-pushes or removes the pinned object (rare).

## `.gitmodules` URL change procedure

1. Ensure working tree clean: `git -C vendor/scratch-editor status --porcelain` empty.
2. Confirm SHA: `git -C vendor/scratch-editor rev-parse HEAD` equals `SCRATCH_PIN.md`.
3. Create fork on GitHub (human/org — agents must not create forks unilaterally).
4. Edit `.gitmodules` `url` to the fork.
5. `git submodule sync -- vendor/scratch-editor`
6. `git -C vendor/scratch-editor remote rename origin upstream` (optional) and add `origin` = fork.
7. Push the **same SHA** to fork: `git push origin 7c172e469eb3c21c1e6326ea6cccea60bc14e3a8:refs/heads/gate0-pin`
8. Verify: `pnpm gate0:check-pin` still passes (SHA unchanged).

## Confirm SHA preserved after migration

```powershell
git -C vendor/scratch-editor rev-parse HEAD
# must equal SCRATCH_PIN.md
pnpm gate0:check-pin
```

## CI checks

`scripts/check-submodule-pin.mjs` verifies:

- Parsed SHA from `docs/gate0/SCRATCH_PIN.md`
- `git rev-parse HEAD` equality
- Empty `git status --porcelain` in submodule
