# Release 1 Slice — Google Auth, Session & Organization Foundation Design

> **Date:** 2026-07-15  
> **Status:** Draft for review (do not implement until approved)  
> **Baselines:** Gate 0 Technical Go @ `4a14e05`; R1 persistence Technical Go @ `3d6053b` (HTTP 422 harden @ `7cb76cd`)  
> **Spec anchors:** §6–8, §44–45, §46, §55  
> **Next after Go:** Scratch editor + safe SB3 I/O wired to persistence APIs

## 1. Goal

Replace stub header identity (`x-user-id` / `x-organization-id`) on the **production persistence path** with:

1. Google GIS ID token verification (reuse Gate 0 `@blocksync/google-identity`)
2. Durable organizations / users / external identities / sessions in SQLite
3. Opaque server-side sessions via `HttpOnly` Cookie
4. Cookie-resolving `AuthContext` plugged into existing project APIs
5. Process-restart survival for orgs, users, and sessions

**Final Go** for this slice requires: fixture suite green **and** evidence of real Google GIS + allowed Workspace `hd` success. Without credentials: label verdict **Technical Go — real GIS conditional**.

Out of scope: teacher/student roles UI, admin console, multi-IdP, Classroom, invites, passwords, AI, Scratch edit UI, WebSocket session fan-out (§8.2 WS items deferred to collab slice).

## 2. Current state (survey)

```text
Gate 0:  verifyGoogleIdToken(iss/aud/exp/iat/alg/sub/email_verified/hd)  ──┐
                                                                           │ unconnected
R1:      StubAuthContext(x-user-id) → ProjectService → Durable ACL (SQLite)
```

| Area | Finding |
|---|---|
| `auth-context` | Identity-only `resolve`; stub principals `user-a`/`user-b` @ `org-demo` |
| `google-identity` | Production-ready verifier + test hooks gated |
| R1 SQLite | `projects` / `project_members` only — **no** users/sessions/org tables |
| `r1-persist-server` | Always wires `StubAuthContext`; `CreateServerDeps.auth` unused in Hono layer |
| Auth smoke | `gate0-auth-smoke` skips without `GOOGLE_CLIENT_ID`; no automated browser GIS |

## 3. Approaches

| Approach | Idea | Pros | Cons |
|---|---|---|---|
| **A. Opaque session cookie + SQLite session store (recommended)** | Verify Google ID token once; issue random session id; store **hash only**; Cookie carries opaque id; `SessionAuthContext.resolve` loads session→user→org | Matches §8.2; revoke/logout/expiry are server-forced; no Google token retention; fits current SQLite ports | Requires CSRF design for cookie mutations |
| **B. Signed app JWT as session** | After Google verify, mint HS256/RS256 JWT in Cookie | Stateless scale-out | Logout/revoke harder; larger cookie; risk of putting PII in JWT; worse fit for “server-forced invalidation” |
| **C. Session store in Redis / separate auth service** | Same as A but external store | Multi-node ready | Ops weight; premature for single-process R1 |

**Recommendation: A.** Keep ports (`SessionRepository`) so Postgres/Redis can replace SQLite later without changing HTTP contracts.

## 4. Architecture

```text
Browser (GIS)
   │ credential (ID token)  -- once, never stored
   ▼
POST /v1/auth/google
   → verifyGoogleIdToken
   → upsert org(domain←hd) + user + external_identity(google,sub)
   → create session (raw id → Cookie; hash → DB)
   ▼
Cookie: blocksync_session=<opaque>  (HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age)
   + CSRF: see §7
   ▼
SessionAuthContext.resolve({ cookies, headers })
   → load session by hash; check expiry/revoked; load user+primary org membership
   → AuthPrincipal { userId, organizationId, displayName? }
   ▼
Existing ProjectService (unchanged ACL contract)
   resolve OUTSIDE TX → DurableProjectAccessPolicy INSIDE TX
```

### Packages / apps

| Unit | Role |
|---|---|
| `@blocksync/auth-context` | Keep `AuthContext` / `AuthPrincipal`; extend `AuthRequestHints` with `cookies`; keep `StubAuthContext` **test-only** |
| `@blocksync/google-identity` | Unchanged (dependency) |
| `@blocksync/session-service` | Login / logout / me / session lifecycle use-cases + ports |
| `@blocksync/auth-store-sqlite` | Migrations + adapters for org/user/session (or extend `project-store-sqlite` with namespaced migrate — prefer **shared DB file**, separate migrate module) |
| `apps/r1-persist-server` | Auth routes + Cookie jar + CSRF middleware + wire `SessionAuthContext` |
| `apps/r1-auth-demo` / expand persist tests | Fixture acceptance + optional real GIS smoke |

**Shared data directory:** same `R1_DATA_DIR/projects.sqlite` (or `auth.sqlite` co-located — **prefer one DB** so FK from `projects.owner_user_id` can eventually align; for this slice, introduce users first and **migrate stub string ids** carefully — see §6.3).

## 5. Stub vs production configuration boundary (critical)

| Knob | Production path | Test / local stub path |
|---|---|---|
| `R1_AUTH_MODE` | **`google`** (required when `NODE_ENV=production`) | `stub` allowed only if `NODE_ENV !== "production"` |
| AuthContext impl | `SessionAuthContext` only | `StubAuthContext` may be constructed |
| Cookie `Secure` | **must be true** when `R1_AUTH_MODE=google` OR `NODE_ENV=production`; process **refuses to boot** if `R1_COOKIE_SECURE=false` in those modes | May set `R1_COOKIE_SECURE=false` for HTTP localhost when `R1_AUTH_MODE=stub` **or** explicit `R1_ALLOW_INSECURE_COOKIES=1` with `NODE_ENV=test` only |
| Header spoofing | Ignore `x-user-id` / `x-organization-id` entirely in google mode | Stub mode may read them |
| Compile/runtime guard | `assertProductionAuthConfig()` in `main` before listen | Vitest sets `R1_AUTH_MODE=stub` |

```typescript
// Pseudocode — boot refuse
if (process.env.NODE_ENV === "production" && process.env.R1_AUTH_MODE !== "google") {
  throw new Error("R1_AUTH_MODE=google required in production");
}
if (authMode === "google" && cookieSecure !== true) {
  throw new Error("Secure cookies required for google auth mode");
}
if (authMode === "stub" && process.env.NODE_ENV === "production") {
  throw new Error("StubAuthContext forbidden in production");
}
```

`StubAuthContext` remains exported for unit/acceptance tests and optional local demos; **production bootstrap never imports it into the live wire**.

## 6. Data model (migration)

SQLite additions (same file as projects recommended):

### 6.1 Tables

```sql
organizations(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,           -- active|suspended
  created_at TEXT NOT NULL
);

organization_domains(
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  hosted_domain TEXT NOT NULL,  -- Google hd, lowercased
  PRIMARY KEY (organization_id, hosted_domain),
  UNIQUE (hosted_domain)        -- one org per hd in this slice
);

users(
  id TEXT PRIMARY KEY,            -- server-generated UUID
  primary_organization_id TEXT NOT NULL REFERENCES organizations(id),
  display_name TEXT,
  email TEXT,                     -- mutable contact; NOT identity key
  status TEXT NOT NULL,           -- active|disabled
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

external_identities(
  provider TEXT NOT NULL,         -- 'google'
  subject TEXT NOT NULL,          -- Google sub
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, subject)
);

organization_memberships(
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- member|admin (no teacher/student UI yet)
  PRIMARY KEY (organization_id, user_id)
);

sessions(
  id_hash TEXT PRIMARY KEY,       -- sha256(rawSessionId)
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  csrf_hash TEXT NOT NULL,        -- sha256(rawCsrfToken) for synchronizer
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,                -- null if active
  last_seen_at TEXT
);
```

**Never store:** Google ID token / access token / refresh token / raw session id / raw CSRF in DB or logs.

### 6.2 Org resolution from `hd`

- Config allow-list: `R1_ALLOWED_HOSTED_DOMAINS` (comma-separated) **and/or** rows in `organization_domains` seeded at boot from that env.
- Login: after `verifyGoogleIdToken({ allowedHostedDomains })`, resolve org by `claims.hd` → `organization_domains`; if domain allowed in env but org missing → **create org + domain** (slice rule) **or** require pre-seed — **choose: auto-create org for allowed hd** to keep ops light; name = hd.
- Missing/invalid hd / not allow-listed → auth failure (generic).

### 6.3 Compatibility with existing projects

Today `projects.owner_user_id` is `"user-a"` strings and org `"org-demo"`.

Migration strategy for this slice:

1. Seed **demo stub org** only in stub mode.
2. In google mode: new users get UUID user ids; **existing fixture projects owned by stub users remain for stub-mode tests only**.
3. Acceptance BOLA under google mode uses two real fixture users/orgs created via login flow (not stub headers).
4. Optional one-time note in runbook: persistence Go projects under stub ids are not portable into google-mode ACL without remapping (accept for R1).

## 7. Cookie, CSRF, expiry, revocation

### 7.1 Session cookie

| Attribute | Value |
|---|---|
| Name | `blocksync_session` |
| Value | opaque random (≥ 256-bit, base64url) |
| HttpOnly | `true` |
| Secure | config; guarded (§5) |
| SameSite | `Lax` |
| Path | `/` |
| Max-Age / Expires | e.g. 7 days absolute; sliding `last_seen` optional (slice: absolute expiry only) |

### 7.2 CSRF (§8.2)

**Synchronizer token pattern (recommended for SPA + cookie auth):**

1. On login (and session refresh), generate `csrf` random; store `sha256(csrf)` on session row; return csrf **once** in JSON body of `/v1/auth/google` and `/v1/auth/me` (not in HttpOnly cookie).
2. Mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`) must send header `X-CSRF-Token: <csrf>`.
3. Middleware compares `sha256(header)` to `sessions.csrf_hash` for the resolved session.
4. Safe methods (`GET` `/me`, list) do not require CSRF.
5. Additionally reject mutating requests with foreign `Origin` when `Origin` present and not in `R1_ALLOWED_ORIGINS`.

Login response reissues session id (**session fixation** mitigation per §8.2).

### 7.3 Expiry & revocation

- Expired (`now >= expires_at`) or `revoked_at != null` → treat as unauthenticated (401).
- `POST /v1/auth/logout` sets `revoked_at`, clears Cookie (`Max-Age=0`).
- Replayed Cookie after logout → 401.
- Disabled user / suspended org → 401 on resolve (generic).

## 8. AuthContext surface

```typescript
export interface AuthRequestHints {
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string | undefined>;
}

export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  displayName?: string;
}

export interface AuthContext {
  resolve(request: AuthRequestHints): Promise<AuthPrincipal>;
}
```

- `SessionAuthContext`: Cookie → session hash → principal; **never** reads spoof headers in google mode.
- `StubAuthContext`: headers only; test/local stub mode.
- Project service keeps: `await auth.resolve` **outside** DB TX; ACL inside sync TX.

HTTP layer extracts Cookie header into `cookies` map before calling service.

## 9. API contract

### 9.1 `POST /v1/auth/google`

Body: `{ "idToken": "<GIS credential>" }` (never log).

Success `200`:

```json
{
  "user": { "id": "...", "organizationId": "...", "displayName": "...", "email": "..." },
  "csrfToken": "...",
  "expiresAt": "ISO-8601"
}
```

Set-Cookie: session. **Do not** return session raw id in JSON.

Failure `401` with opaque `{ "code": "AUTH_FAILED" }` (no VerifyFailureCode leakage to clients). Map internally for metrics only.

### 9.2 `GET /v1/auth/me`

Cookie required. Returns user + `csrfToken` + `expiresAt`. `401` if missing/invalid session.

### 9.3 `POST /v1/auth/logout`

Cookie + CSRF. Revoke session; clear Cookie. `204`.

### 9.4 Existing project routes

Require Cookie session (google mode). CSRF on mutations. Spoofed `x-user-id` / `x-organization-id` **ignored**.

## 10. Security / threat model (slice)

| Threat | Mitigation |
|---|---|
| Header spoofing / privilege theft | Google mode ignores client identity headers |
| Session fixation | Rotate session id on login |
| Session theft (XSS) | HttpOnly cookie; no token in localStorage |
| CSRF | Synchronizer token + Origin allow-list |
| Google token theft from logs/DB | Never persist; redacted logging |
| Email as stable id | Identity key = `(google, sub)` only |
| hd abuse | `allowedHostedDomains` + DB domain table |
| Unverified email | `email_verified === true` required |
| Secure=false in prod | Boot guard |
| Auth error oracle | Generic `AUTH_FAILED` externally |
| BOLA across orgs | Existing durable ACL + two-org fixture tests |
| TX misuse | Auth resolve outside TX (preserve R1 persist contract) |

Logging: forbid printing Cookie, `Authorization`, `idToken`, session raw id, CSRF raw token. Structured logs may include `userId` / `sessionIdHash` prefix only.

## 11. Verification matrix

### 11.1 Fixture (blocking Technical Go)

| Case | Expect |
|---|---|
| Valid Google fixture token → login | Cookie Set; `/me` 200 |
| Bad signature / wrong aud / wrong iss / expired | 401 AUTH_FAILED |
| Missing hd / hd mismatch / not allow-listed | 401 |
| `email_verified !== true` | 401 |
| Same `sub` re-login | Same `user.id` |
| Email claim changes, same `sub` | Same `user.id`; email field updated |
| DB has only session **hash** | Assert no raw cookie value in `sessions` |
| Expired / revoked session | 401 |
| Logout then reuse Cookie | 401 |
| Process restart | Valid session still `/me` 200 |
| Spoof `x-user-id` under google mode | No privilege change |
| Two users / two orgs BOLA on CRUD/save/snapshot/restore | Non-member 404 |
| Auth resolve outside TX; ACL uses SQLite membership | Contract test |
| Logs/errors contain no credential substrings | Unit/integration |

Use `google-identity` test hooks + local JWKS like Gate 0 tests.

### 11.2 Real GIS (blocking Final Go; conditional Technical Go)

| Case | When |
|---|---|
| Browser GIS → live `/v1/auth/google` → Cookie → `/me` | `GOOGLE_CLIENT_ID` + `R1_ALLOWED_HOSTED_DOMAINS` present |
| Workspace account with allowed `hd` | Manual/smoke evidence recorded |

Script: opt-in Vitest describe skipped unless env set; document evidence in `docs/r1/AUTH_EVIDENCE.md` (filled when run). **Without evidence:** “Technical Go — real GIS conditional”.

## 12. Acceptance criteria (product)

Matches user-required list in the slice brief (login cookie, negative verifications, sub stability, hash storage, expiry/logout, restart, anti-spoof, BOLA, TX boundary, no token leakage) + config Secure guard + CSRF on mutations.

## 13. Non-goals / deferred

Teacher roles, Classroom, invites, password auth, multi-IdP, WS revoke fan-out, admin UI, Scratch editor bind.

## 14. Review checklist

- [ ] Approach A approved  
- [ ] Stub/production config boundary approved  
- [ ] Cookie + CSRF + expiry/revoke approved  
- [ ] Schema / migration approach approved  
- [ ] API contract approved  
- [ ] Fixture vs real GIS matrix + conditional Go wording approved  
- [ ] Ready for implementation plan execution after approval  
