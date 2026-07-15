# R1 Auth / Session / Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cookie-session Google auth with immutable sub竊弛rg bind, double-submit CSRF Cookie, and production stub exclusion 窶・without regressing R1 persistence ACL/CAS.

**Architecture:** One SQLite connection owned by `project-store-sqlite`; auth migrate + `AuthRepository` share that connection; `SessionAuthContext` + session-service; Hono Origin/CSRF/Cookie matrix per design.

**Tech Stack:** TypeScript, pnpm, Vitest, better-sqlite3 ^12.11.1+, Hono, `@blocksync/google-identity` (**claim surface unchanged** 窶・no `name`). Spec: `docs/superpowers/specs/2026-07-15-r1-auth-org-design.md`.

## Global Constraints

- Design invariants for CSRF routes, Origin (mandatory on login + mutating), and sub竊弛rg bind are **non-negotiable**
- Never store Google ID tokens / raw session / raw CSRF in DB or logs
- Production session/CSRF ids: `randomBytes(32).toString("base64url")` only (DI for tests)
- `AuthContext.resolve` outside TX; ACL + login upsert inside sync TX as specified
- Do not start Tasks until design re-approval
- Do not alter Gate 0 / R1 persistence Technical Go SHAs

---

### Task 1: Boot config + AuthRequestHints cookies

**Files:**
- Modify: `packages/auth-context/src/index.ts`, `index.test.ts`
- Create: `apps/r1-persist-server/src/auth-config.ts`, `auth-config.test.ts`

```typescript
export interface AuthRequestHints {
  headers: Record<string, string | undefined>
  cookies?: Record<string, string | undefined>
}
export type AuthMode = "stub" | "google"
export function assertAuthBootConfig(env: NodeJS.ProcessEnv): {
  mode: AuthMode
  cookieSecure: boolean
  allowedHostedDomains: string[]
  allowedOrigins: string[]          // required non-empty in google mode
  googleClientId: string | undefined
  googleAuthorizedParties: string[] // from R1_GOOGLE_AUTHORIZED_PARTIES; may be empty
}
```

- [ ] **Step 1: Failing tests** 窶・production+stub refuse; google+Secure=false refuse; google+empty allowedOrigins refuse; parties parsed

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(auth): cookie hints and auth boot guards`

---

### Task 2: Auth schema on shared DB connection

**Files (ownership fixed):**
- Modify: `packages/project-store-sqlite/src/migrate.ts` 窶・call `migrateAuth(db)` after project tables; keep `PRAGMA foreign_keys=ON`
- Create: `packages/project-store-sqlite/src/migrate-auth.ts`
- Create: `packages/project-store-sqlite/src/auth-repository.ts`, `auth-repository.contract.test.ts`
- Modify: `packages/project-store-sqlite/src/repository.ts` / `index.ts` 窶・export `openSqliteDatabase(path)` **or** `openSqliteProjectRepository` returns `{ db, projectRepo, authRepo, close }` so bootstrap holds **one** close

**Pinned connect lifecycle:**
1. `bootstrap` 竊・`const store = openSqliteStore(dbPath)` // opens once
2. `store` runs project migrate + auth migrate
3. `projectRepo` + `authRepo` share `store.db`
4. Only `store.close()` closes the connection

Schema: design ﾂｧ6.1 including FKs, CHECKs, `external_identities.organization_id`, composite FK `sessions(organization_id,user_id) 竊・organization_memberships`.

```typescript
export interface AuthRepository {
  withTransaction<T>(fn: (tx: AuthRepositoryTx) => T): T // SYNC
}
export interface AuthRepositoryTx {
  findOrgIdByHostedDomain(hd: string): string | null
  ensureOrgForHostedDomain(hd: string, name: string): string
  findExternalIdentity(provider: "google", subject: string): {
    userId: string
    organizationId: string
  } | null
  createUser(...): void
  updateUserEmail(userId: string, email: string | null): void // no displayName from Google
  ensureMembership(organizationId: string, userId: string, role: "member"|"admin"): void
  insertExternalIdentity(args: {
    provider: "google"; subject: string; userId: string; organizationId: string
  }): void
  createSession(...): void
  getSessionByHash(idHash: string): SessionRow | null
  hasActiveMembership(organizationId: string, userId: string): boolean
  revokeSession(idHash: string, revokedAt: string): void
}
```

- [ ] **Step 1: Contract tests** 窶・reopen DB; FK enforce; concurrent first-login simulation unique on `(provider,subject)`

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(auth-store): auth tables on shared sqlite connection`

---

### Task 3: session-service (bind invariants + entropy)

**Files:**
- Create: `packages/session-service/**`

```typescript
export function createSessionService(deps: {
  authRepo: AuthRepository
  verifyGoogleIdToken: typeof verifyGoogleIdToken
  googleAudience: string
  authorizedParties?: string[]   // omit/undefined => azp not enforced
  allowedHostedDomains: string[]
  sessionTtlSec: number
  now: () => Date
  /** Production: () => randomBytes(32).toString("base64url") */
  randomToken: () => string
  hash: (raw: string) => string
}): SessionService
```

Login algorithm (single sync TX after successful verify):

1. Resolve org from `hd` (ensure if first-seen allow-listed domain)
2. `findExternalIdentity(google, sub)`:
   - **Exists:** if `identity.organizationId !== resolvedOrgId` 竊・fail `AUTH_FAILED` (no writes). Else update email optional; create **new** session (+ rotate csrf) for existing user/org
   - **Missing:** create org (if needed), user, identity (with organization_id), membership, session 窶・all in **one** `withTransaction`
3. Return cookie material: raw session + raw csrf (hashes only to DB)

- [ ] **Step 1: Failing tests**
  - first login creates bind
  - re-login same hd OK; different hd AUTH_FAILED + no membership/org change
  - parallel first login 竊・one identity
  - email updates; displayName not set from token
  - authorizedParties passed through when configured

- [ ] **Step 2: Implement** (production default `randomToken` = 32-byte base64url)

- [ ] **Step 3: PASS; commit** `feat(session-service): google login with immutable org bind`

---

### Task 4: SessionAuthContext (membership every resolve)

**Files:**
- Create: `packages/auth-context/src/session-auth-context.ts`, tests

Resolve steps: cookie 竊・hash 竊・session row 竊・not revoked/expired 竊・user/org active 竊・**`hasActiveMembership`** 竊・principal. Ignore spoof headers.

- [ ] **Step 1: Failing tests** 窶・membership removed 竍・resolve throws; spoof headers ignored

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(auth-context): SessionAuthContext membership gate`

---

### Task 5: Hono cookies, Origin, CSRF matrix

**Files:**
- Create: `apps/r1-persist-server/src/cookies.ts`, `csrf.ts`, `origin.ts`
- Modify: `server.ts`, `bootstrap.ts`, `main.ts`
- Tests: `auth.routes.test.ts`, extend `server.test.ts`

Cookie helpers must set/clear with identical `Secure` / `SameSite=Lax` / `Path=/` for `blocksync_session` (HttpOnly) and `blocksync_csrf` (!HttpOnly).

Route matrix = design ﾂｧ7.3 exactly.

`verifyGoogleIdToken` options:
```typescript
{
  audience: googleClientId,
  allowedHostedDomains,
  requireEmailVerified: true,
  authorizedParties: parties.length ? parties : undefined,
}
```

- [ ] **Step 1: Failing HTTP tests**
  - login without Origin 竊・403
  - login wrong Origin 竊・403
  - login OK sets both cookies
  - mutation without Origin 竊・403
  - mutation with CSRF + Origin OK after restart (same data dir; cookies preserved by client jar)
  - logout clears both cookies with same Secure/SameSite/Path attributes
  - spoof headers ignored under google mode

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): cookie CSRF Origin auth routes`

---

### Task 6: Fixture acceptance + BOLA

**Files:**
- Create/modify: `apps/r1-auth-demo` or extend `r1-persist-demo` google-mode suite

Blocking cases: design ﾂｧ12.1 (including hd mismatch, membership revoke竊・01, concurrent login, cookie clear attrs, CSRF after reload/restart).

- [ ] **Step 1: Failing acceptance**

- [ ] **Step 2: Helpers (cookie jar)**

- [ ] **Step 3: PASS; commit** `test(r1): auth fixture acceptance`

---

### Task 7: Real GIS smoke (conditional) + evidence

**Files:**
- `apps/r1-auth-smoke/**`, `docs/r1/AUTH_EVIDENCE.md` template
- CI: fixture auth only (no live GIS required)

Verdict wording: **Technical Go 窶・real GIS conditional** without evidence.

- [ ] Commit `docs(r1): auth smoke and evidence template`

---

### Task 8: Runbooks + CI typecheck

**Files:**
- `docs/r1/AUTH.md`, `docs/r1/AUTH_GO_NO_GO.md` stub
- Update `PERSISTENCE.md` auth pointer
- CI workflow typecheck + auth fixture tests

Document: `R1_GOOGLE_AUTHORIZED_PARTIES`, Origin list, Secure guards, stub forbidden in production, entropy rule.

- [ ] Commit `docs(r1): auth runbook and CI`

---

## Spec coverage self-check

| Requirement | Task |
|---|---|
| CSRF Cookie + DB hash; no plaintext CSRF in DB | 3, 5, 6 |
| `/auth/google` no CSRF; Origin+JSON+CORS | 5, 6 |
| Mutations Origin mandatory | 5, 6 |
| Immutable sub竊弛rg; hd mismatch fail | 3, 6 |
| Membership on every resolve | 4, 6 |
| Concurrent first login single TX | 2, 3, 6 |
| Shared DB connection ownership | 2, 5 |
| FK/CHECK/composite FK | 2 |
| No Google `name` / displayName sync | 3 |
| `randomBytes(32)` | 3, 5 |
| azp / authorizedParties policy | 1, 3, 5 |
| Cookie clear attribute parity test | 5, 6 |
| Stub production boundary | 1, 5 |

## Execution gate

**Do not implement until revised design is approved.**
