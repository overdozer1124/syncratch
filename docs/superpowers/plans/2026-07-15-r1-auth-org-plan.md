# R1 Auth / Session / Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stub header auth on the R1 persistence production path with Google ID token verification, durable org/user/session storage, opaque HttpOnly cookies, and Cookie-based `AuthContext`, without regressing persistence ACL/CAS.

**Architecture:** Reuse `@blocksync/google-identity`; add session use-cases + SQLite auth tables (shared `R1_DATA_DIR` DB); `SessionAuthContext` for production; `StubAuthContext` test-only behind `R1_AUTH_MODE` boot guards; Hono auth routes + CSRF middleware on mutating APIs.

**Tech Stack:** TypeScript, pnpm, Vitest, better-sqlite3 ^12.11.1+, Hono, jose (via google-identity). Spec: `docs/superpowers/specs/2026-07-15-r1-auth-org-design.md`. Baselines: Gate 0 @ `4a14e05`; R1 persist @ `3d6053b`.

## Global Constraints

- Do not alter Gate 0 or R1 persistence **Technical Go** verdicts  
- Never store Google ID tokens / raw session ids / raw CSRF in DB or logs  
- Email is not the stable identity key — `(provider, subject)` is  
- `AuthContext.resolve` stays **outside** SQLite transactions; ACL remains durable membership inside sync TX  
- Production boot: `R1_AUTH_MODE=google`, `Secure` cookies required; stub forbidden  
- TDD per task; commit per task  
- **Do not start Tasks until this design is approved**

---

### Task 1: AuthRequestHints cookies + config guards

**Files:**
- Modify: `packages/auth-context/src/index.ts`, `index.test.ts`
- Create: `packages/auth-context/src/config.ts`, `config.test.ts` (or `apps/r1-persist-server/src/auth-config.ts` if preferred — **prefer shared `auth-context` or small `@blocksync/r1-auth-config`**; use `apps/r1-persist-server/src/auth-config.ts` to avoid over-package — decide: **server-local `auth-config.ts`**)

**Interfaces:**
```typescript
export interface AuthRequestHints {
  headers: Record<string, string | undefined>
  cookies?: Record<string, string | undefined>
}
// StubAuthContext unchanged behavior when only headers present
```

Boot helper:
```typescript
export type AuthMode = "stub" | "google"
export function resolveAuthMode(env: NodeJS.ProcessEnv): AuthMode
export function assertAuthBootConfig(env: NodeJS.ProcessEnv): {
  mode: AuthMode
  cookieSecure: boolean
  allowedHostedDomains: string[]
  allowedOrigins: string[]
  googleClientId: string | undefined
}
```

- [ ] **Step 1: Failing tests** — stub still resolves headers; `assertAuthBootConfig` refuses `stub`+`NODE_ENV=production`; refuses `google` with `cookieSecure=false`; allows stub+insecure only for non-production

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(auth): AuthRequestHints cookies and boot config guards`

---

### Task 2: Auth SQLite schema + repositories

**Files:**
- Create: `packages/auth-store-sqlite/**` OR extend `packages/project-store-sqlite/src/migrate-auth.ts` + `auth-repository.ts`  
  **Decision for implementer:** extend `project-store-sqlite` migrations in same DB (`migrate.ts` calls `migrateAuth`) to keep one connection — simpler for FKs later.

**Tables:** `organizations`, `organization_domains`, `users`, `external_identities`, `organization_memberships`, `sessions` per design §6.

**Interfaces:**
```typescript
export interface AuthRepository {
  withTransaction<T>(fn: (tx: AuthRepositoryTx) => T): T  // SYNC only
  // optional close
}
export interface AuthRepositoryTx {
  findOrgIdByHostedDomain(hd: string): string | null
  ensureOrgForHostedDomain(hd: string, name: string): string
  findUserIdByGoogleSub(sub: string): string | null
  createUser(args: { id: string; organizationId: string; displayName?: string; email?: string }): void
  updateUserProfile(userId: string, args: { displayName?: string; email?: string }): void
  ensureMembership(organizationId: string, userId: string, role: string): void
  insertExternalIdentity(provider: "google", subject: string, userId: string): void
  createSession(args: {
    idHash: string; userId: string; organizationId: string; csrfHash: string;
    createdAt: string; expiresAt: string;
  }): void
  getSessionByHash(idHash: string): SessionRow | null
  revokeSession(idHash: string, revokedAt: string): void
  touchSession?(idHash: string, lastSeenAt: string): void
}
```

- [ ] **Step 1: Failing contract tests** — create org/user/session; reopen DB; session row persists; raw id not stored (store hash only)

- [ ] **Step 2: Implement migrate + repo with better-sqlite3 sync TX**

- [ ] **Step 3: PASS; commit** `feat(auth-store): organizations users sessions sqlite schema`

---

### Task 3: session-service (login / logout / me)

**Files:**
- Create: `packages/session-service/**`

**Interfaces:**
```typescript
export function createSessionService(deps: {
  authRepo: AuthRepository
  verifyGoogleIdToken: typeof verifyGoogleIdToken
  googleAudience: string
  allowedHostedDomains: string[]
  sessionTtlSec: number
  now: () => Date
  randomId: () => string  // session + csrf raw
  hash: (raw: string) => string  // sha256 hex
}): SessionService

// loginGoogle({ idToken }) => { setCookieRawSessionId, csrfToken, user, expiresAt }
// never returns raw session in JSON field named sessionId — only via cookie channel object
```

Rules:
- Call `verifyGoogleIdToken` with `requireEmailVerified: true`, `allowedHostedDomains`
- Upsert by Google `sub`; update email/displayName if changed
- On login: new session (rotate); revoke previous optional (slice: leave other sessions; document)
- Failures throw internal codes; HTTP maps to generic AUTH_FAILED

- [ ] **Step 1: Failing unit tests** with fake verify + memory/sqlite auth repo — success path; reject verify failures; same sub stable user id; email change keeps user; session hash only in repo

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(session-service): google login logout me lifecycle`

---

### Task 4: SessionAuthContext

**Files:**
- Create: `packages/auth-context/src/session-auth-context.ts` (+ tests) **or** in `session-service`

```typescript
export class SessionAuthContext implements AuthContext {
  constructor(deps: { authRepo: AuthRepository; hash: (s: string) => string; cookieName: string; now: () => Date })
  resolve(hints: AuthRequestHints): Promise<AuthPrincipal>
}
```

- Ignores `x-user-id` / `x-organization-id`
- Missing/expired/revoked → throw unauthenticated
- Disabled user / suspended org → unauthenticated

- [ ] **Step 1: Failing tests** including “spoof headers do not change principal”

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(auth-context): SessionAuthContext from cookie hash`

---

### Task 5: Hono auth routes + CSRF + cookie wiring

**Files:**
- Modify: `apps/r1-persist-server/src/server.ts`, `bootstrap.ts`, `main.ts`, `auth-config.ts`
- Create: `apps/r1-persist-server/src/csrf.ts`, `cookies.ts`
- Modify: `apps/r1-persist-server/src/server.test.ts`
- Create: `apps/r1-persist-server/src/auth.routes.test.ts`

Routes: `POST /v1/auth/google`, `GET /v1/auth/me`, `POST /v1/auth/logout`

Middleware:
- Parse Cookie → hints.cookies
- CSRF required on mutating methods when `R1_AUTH_MODE=google`
- Project routes use `SessionAuthContext` in google mode
- Generic 401 body `{ code: "AUTH_FAILED" }` for auth failures
- Ensure error mapper never includes token substrings

- [ ] **Step 1: Failing HTTP tests** — login sets Cookie; `/me`; logout; CSRF missing → 403; spoof headers ignored; Secure/SameSite attributes asserted on Set-Cookie string

- [ ] **Step 2: Implement bootstrap mode switch** (`stub` vs `google`)

- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): cookie auth routes and CSRF`

---

### Task 6: Wire persistence acceptance under google fixture mode

**Files:**
- Modify / create: `apps/r1-persist-demo` or `apps/r1-auth-demo` acceptance tests
- Keep stub-mode tests for local fast path behind `R1_AUTH_MODE=stub`

**Blocking tests (design §11.1):** implement as Vitest with google-identity hooks / fixture JWKS (same patterns as `packages/google-identity` tests).

Must include:
- Full negative claim matrix
- Restart with same data dir keeps session
- Two-org BOLA on existing project APIs using Cookie+CSRF clients
- Log redaction smoke (spy logger)

- [ ] **Step 1: Write failing acceptance suite**

- [ ] **Step 2: Implement test helpers (cookie jar + csrf)**

- [ ] **Step 3: PASS; commit** `test(r1): auth fixture acceptance and BOLA under cookies`

---

### Task 7: Optional real GIS smoke + evidence template

**Files:**
- Create: `apps/r1-auth-smoke/**` (or extend gate0-auth-smoke)
- Create: `docs/r1/AUTH_EVIDENCE.md` template (unchecked when unset)
- Modify: `.github/workflows/r1-persist.yml` → rename/extend `r1-auth.yml` to typecheck + fixture auth tests (real GIS **not** required in CI)

- [ ] Skip unless `GOOGLE_CLIENT_ID` + domains set
- [ ] Document “Technical Go — real GIS conditional” vs Final Go
- [ ] Commit `docs(r1): auth smoke pathway and evidence template`

---

### Task 8: Runbook + CI + Go doc stub

**Files:**
- Create: `docs/r1/AUTH.md`
- Modify: `docs/r1/PERSISTENCE.md` (point to Cookie auth when `R1_AUTH_MODE=google`)
- Create: `docs/r1/AUTH_GO_NO_GO.md` stub (verdict filled after review of evidence)
- Modify: CI workflow for `r1:auth:test` / typecheck

- [ ] Document env vars, cookie flags, stub forbidden in production
- [ ] Commit `docs(r1): auth runbook and CI`

---

## Spec coverage self-check

| Requirement | Task |
|---|---|
| verifyGoogleIdToken reuse | 3, 5, 6 |
| sub primary key; email mutable | 3, 6 |
| hd allow-list | 3, 5 |
| Opaque session hash in DB | 2, 3, 6 |
| Cookie flags + Secure guard | 1, 5 |
| /google /me /logout | 5 |
| SessionAuthContext | 4, 5 |
| Project APIs on Cookie | 5, 6 |
| Restart restore session | 6 |
| Spoof headers ignored | 4, 6 |
| BOLA 2-user/2-org | 6 |
| resolve outside TX | 4, 6 (contract) |
| No token leakage | 5, 6 |
| Stub test-only boundary | 1, 5 |
| Real GIS conditional | 7, 8 |
| CSRF | 5, 6 |

## Execution gate

**Do not start Tasks until design review approves** `docs/superpowers/specs/2026-07-15-r1-auth-org-design.md`.
