# Gate 0 Git state evidence

**Implementation / code freeze SHA:** `4a14e05aba13bf459a534a2a2beffb43657996b3`  
（以降の docs-only commits はこの SHA を証跡として参照する）

**Recorded:** 2026-07-15 after Gate 0 remediations (control boundaries + prior No-Go fixes).

## Captured output

```text
$ git rev-parse 4a14e05aba13bf459a534a2a2beffb43657996b3
4a14e05aba13bf459a534a2a2beffb43657996b3

$ git ls-files --stage vendor/scratch-editor
160000 7c172e469eb3c21c1e6326ea6cccea60bc14e3a8 0	vendor/scratch-editor

$ git submodule status
 7c172e469eb3c21c1e6326ea6cccea60bc14e3a8 vendor/scratch-editor (v14.1.0)

$ Get-Content vendor/scratch-editor/.git
gitdir: ../../.git/modules/vendor/scratch-editor
```

Mode `160000` = gitlink. Submodule SHA matches `docs/gate0/SCRATCH_PIN.md`.

## Pin checker

`scripts/check-submodule-pin.mjs` fails unless:

1. Parent index mode is `160000` at the pin SHA
2. Submodule HEAD matches the pin
3. `.git` is a gitfile under `modules/vendor/scratch-editor`
4. Vendor VM dist exists（build with `pnpm gate0:build-vendor-vm` first on clean checkout）
