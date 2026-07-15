# R1 Auth / Session / Organization — Go / No-Go

**Date:** 2026-07-16  
**Verdict:** **Technical Go — real GIS conditional**  
**Implementation HEAD:** tip of this branch (see submit notes)  
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
| Fixed public UNAUTHORIZED / AUTH_FAILED bodies (no session oracle) | **Go** |
| Expired / revoked / post-logout / invalid expires_at → 401 | **Go** |
| VerifyFailureCode → identical AUTH_FAILED at login boundary | **Go** |
| Acyclic packages + `openSqliteStore` | **Go** |
| Real GIS + Workspace `hd` live smoke | **Conditional** — no evidence uploaded |

## Reproduce

```text
pnpm build
pnpm gate0:test
pnpm r1:persist:test
pnpm r1:auth:test
```

## Fixture evidence pointers

| Evidence | Where |
|---|---|
| DB migration / FK / unique `(provider,subject)` | `packages/project-store-sqlite/src/auth-repository.contract.test.ts` |
| CSRF both-required; CORS preflight; `cookieSecure=false` and `true` set+clear Secure | `apps/r1-persist-server/src/auth.routes.test.ts` |
| VerifyFailureCode → identical `AUTH_FAILED` body | `apps/r1-persist-server/src/auth.routes.test.ts` |
| Two-org BOLA; hd mismatch; membership delete→401; concurrent first login; restart CSRF; hashed-only secrets | `apps/r1-persist-server/src/auth.acceptance.test.ts` |
| Expired / revoked / logout-reuse / indistinguishability of auth reject bodies | `apps/r1-persist-server/src/auth.acceptance.test.ts` |
| SessionAuthContext: ok, missing cookie, disabled, expired, revoked, invalid expires_at, unknown | `packages/session-service/src/session-auth-context.test.ts` |
| Empty `R1_ALLOWED_HOSTED_DOMAINS` refused at boot (google) | `apps/r1-persist-server/src/auth-config.test.ts` |
| Runbook | `docs/r1/AUTH.md` |
| Real GIS template | `docs/r1/AUTH_EVIDENCE.md` |

## Final Go gate

Promote beyond conditional only after `docs/r1/AUTH_EVIDENCE.md` is completed with real GIS + Workspace `hd` artifacts.
