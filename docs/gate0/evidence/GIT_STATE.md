# Gate 0 Git state evidence

Recorded 2026-07-15 after remediation (commands succeeded: check-pin, build, check-licenses, gate0:test, gate0:collab).

## Captured output

```text
$ git ls-files --stage vendor/scratch-editor
160000 7c172e469eb3c21c1e6326ea6cccea60bc14e3a8 0	vendor/scratch-editor

$ git submodule status
 7c172e469eb3c21c1e6326ea6cccea60bc14e3a8 vendor/scratch-editor (v14.1.0)

$ Get-Content vendor/scratch-editor/.git
gitdir: ../../.git/modules/vendor/scratch-editor

$ Test-Path .tmp-vm-dist
False
```

Mode `160000` = gitlink. SHA matches `docs/gate0/SCRATCH_PIN.md`.

## Pin checker

`scripts/check-submodule-pin.mjs` fails unless:

1. Parent index mode is `160000` at the pin SHA
2. Submodule HEAD matches the pin
3. `.git` is a gitfile under `modules/vendor/scratch-editor`
4. Vendor VM dist exists

## Ignored artifacts

- `.tmp-vm-dist/` — gitignored; removed from worktree
- `vendor/scratch-editor/**/dist/` and `node_modules/` — already ignored
