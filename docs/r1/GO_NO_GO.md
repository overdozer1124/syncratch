# R1 Project Persistence Slice — Go / No-Go

**Date:** 2026-07-15  
**Verdict:** **Technical Go**  
**Approval baseline SHA:** `3d6053b3652c286b10f1fd75ffb5ae4f9b23bf31`

Gate 0 Technical Go (`4a14e05`) は変更しない。本スライスは R1 永続化パスのみ。

## Scope approved

| Item | Status |
|---|---|
| Approach A (SQLite + FS behind ports) | **Go** |
| Identity-only `AuthContext` + durable ACL | **Go** |
| Sync `withTransaction` + CAS + idempotent save/restore | **Go** |
| Full-document canonicalize + `contentHash` / `requestHash` | **Go** |
| Generation-aware autosave | **Go** |
| Explicit snapshots + atomic FS + startup orphan GC | **Go** |
| Child-process restart acceptance | **Go** |
| Hono HTTP + app typecheck in CI | **Go** |
| Scratch UI / Google OAuth / Yjs | Out of scope |

## Reproduce

```text
pnpm r1:persist:test
```

Expected: typecheck PASS, all 8 packages PASS.

## Notes

- Non-blocking hardening (HTTP 422 mapping for `SNAPSHOT_HASH_MISMATCH`) may land after the approval baseline; it does not change the Go verdict.
- Next implementation unit may begin from this approved baseline.
