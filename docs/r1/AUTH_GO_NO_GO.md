# R1 Auth / Session / Organization — Go / No-Go

**Date:** 2026-07-16  
**Verdict:** **Technical Go — real GIS conditional**  
**Implementation HEAD:** `95acb0b032f41fdded84d483bc75f9fa27941abd`  
**Design / Plan baseline:** `ed1303e4f813c487d8e2b5fa373e68e1f221e3d3`

Gate 0 Technical Go and R1 persistence Technical Go baselines are unchanged.

## Scope

| Item | Status |
|---|---|
| Opaque session cookie + SQLite hash store | **Go** |
| Double-submit CSRF Cookie + header (both required) | **Go** |
| Mandatory Origin on login + mutations; CORS credentials rules | **Go** |
| Immutable `(google,sub)→org` bind | **Go** |
| Membership re-check on every session resolve | **Go** |
| Concurrent first-login uniqueness | **Go** |
| Acyclic packages: `auth-context` ← `session-service` ← `project-store-sqlite` | **Go** |
| `openSqliteStore` sole factory | **Go** |
| Real GIS + Workspace `hd` live smoke | **Conditional** — no evidence uploaded |

## Reproduce

```text
pnpm build
pnpm gate0:test
pnpm r1:persist:test
pnpm r1:auth:test
```

All four commands passed on the submit HEAD (working tree clean).

## Fixture evidence pointers

| Evidence | Where |
|---|---|
| DB migration / FK / unique `(provider,subject)` | `packages/project-store-sqlite/src/auth-repository.contract.test.ts` |
| Cookie Secure/SameSite/Path set+clear; CSRF both-required; CORS preflight | `apps/r1-persist-server/src/auth.routes.test.ts` |
| Two-org BOLA; hd mismatch; membership delete→401; concurrent first login; restart CSRF; hashed-only secrets | `apps/r1-persist-server/src/auth.acceptance.test.ts` |
| Runbook | `docs/r1/AUTH.md` |
| Real GIS template | `docs/r1/AUTH_EVIDENCE.md` |

## Final Go gate

Promote beyond conditional only after `docs/r1/AUTH_EVIDENCE.md` is completed with real GIS + Workspace `hd` artifacts.
