# Release 1 Slice — Google Auth, Session & Organization Foundation Design

> **Date:** 2026-07-15  
> **Status:** Revised draft for re-review (do not implement until approved)  
> **Revision:** CSRF cookie supply + Origin rules; immutable `(sub→org)` bind (post-`efc4a24`)  
> **Baselines:** Gate 0 Technical Go @ `4a14e05`; R1 persistence Technical Go @ `3d6053b`  
> **Spec anchors:** §6–8, §44–45, §46, §55  
> **Next after Go:** Scratch editor + safe SB3 I/O wired to persistence APIs

## 1. Goal

Replace stub header identity (`x-user-id` / `x-organization-id`) on the **production persistence path** with:

1. Google GIS ID token verification (reuse Gate 0 `@blocksync/google-identity`)
2. Durable organizations / users / external identities / sessions in SQLite
3. Opaque server-side sessions via `HttpOnly` Cookie
4. CSRF via **non-HttpOnly** double-submit Cookie + DB hash (restart-/reload-safe)
5. Cookie-resolving `AuthContext` plugged into existing project APIs
6. Process-restart survival for orgs, users, and sessions

**Final Go** requires fixture suite green **and** real Google GIS + allowed Workspace `hd` evidence. Without credentials: **Technical Go — real GIS conditional**.

Out of scope: teacher/student roles UI, admin console, multi-IdP, Classroom, invites, passwords, AI, Scratch edit UI, WebSocket revoke fan-out, **organization transfer / reassignment admin APIs**.

## 2. Current state (survey)

```text
Gate 0:  verifyGoogleIdToken  ──┐
                                │ unconnected
R1:      StubAuthContext(x-user-id) → ProjectService → Durable ACL (SQLite)
```

`GoogleIdentityClaims` today has **no `name`**. This slice does **not** extend that type for display-name sync (see §9.5).

## 3. Approaches

| Approach | Idea | Verdict |
|---|---|---|
| **A. Opaque session cookie + SQLite session store** | Verify Google once; Cookie holds raw session id; DB stores hash; CSRF Cookie holds raw csrf; DB stores csrf hash | **Recommended (approved direction)** |
| B. App JWT session | Stateless cookie JWT | Rejected — revoke/logout weaker |
| C. Redis session service | A + external store | Deferred — ops weight |

## 4. Architecture

```text
POST /v1/auth/google   (no CSRF; strict Origin + JSON CT + CORS)
   → verifyGoogleIdToken(+ authorizedParties when configured)
   → single sync TX: org/user/identity/membership/session (first login)
   → Set-Cookie: blocksync_session (HttpOnly) + blocksync_csrf (NOT HttpOnly)
   ▼
Mutating APIs (logout, project write, snapshot, restore)
   → Origin required + allow-listed
   → Session cookie + X-CSRF-Token (or csrf cookie value) matches sessions.csrf_hash
   ▼
SessionAuthContext.resolve
   → session hash OK + not expired/revoked
   → user.status + org.status active
   → membership(organization_id, user_id) EXISTS (else 401)
   → AuthPrincipal
```

### Connection ownership (fixed)

- **One SQLite file:** `R1_DATA_DIR/projects.sqlite`
- **One connection owner:** `@blocksync/project-store-sqlite` opens/`close`s the `better-sqlite3` Database
- **Migration order:** existing project migrate → auth migrate (`migrateAuth(db)`) in the same boot path
- **Auth repository** receives the **same `Database` instance** (or a thin wrapper) from bootstrap; it must **not** open a second connection and must **not** call `close()`
- `bootstrapPersistRuntime` creates repo once, runs migrations, constructs project + auth adapters, then `SessionAuthContext` / services

## 5. Stub vs production configuration boundary

| Knob | Production (`NODE_ENV=production`) | Non-production |
|---|---|---|
| `R1_AUTH_MODE` | **Must be `google`** — refuse stub | `stub` or `google` |
| AuthContext | `SessionAuthContext` only | Stub allowed when mode=`stub` |
| Cookie `Secure` | **Must be true** for both session + CSRF cookies; boot refuse if false | Local HTTP: insecure only if mode=`stub` **or** (`NODE_ENV=test` + `R1_ALLOW_INSECURE_COOKIES=1`) |
| Spoof headers | Ignored | Stub may read `x-user-id` |

## 6. Data model

### 6.1 Tables (FK / CHECK required)

```sql
PRAGMA foreign_keys = ON;  -- every connection

organizations(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL
);

organization_domains(
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  hosted_domain TEXT NOT NULL,  -- lowercased Google hd
  PRIMARY KEY (organization_id, hosted_domain),
  UNIQUE (hosted_domain)
);

users(
  id TEXT PRIMARY KEY,
  primary_organization_id TEXT NOT NULL REFERENCES organizations(id),
  display_name TEXT,              -- optional local field; NOT synced from Google name this slice
  email TEXT,                     -- mutable contact from claims.email only
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

external_identities(
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  subject TEXT NOT NULL,          -- Google sub
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),  -- bind org at first login
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, subject)
);

organization_memberships(
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('member','admin')),
  PRIMARY KEY (organization_id, user_id)
);

sessions(
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT,
  FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships(organization_id, user_id)
);
```

**Never store:** Google ID token, raw session id, raw CSRF token in DB or logs.

### 6.2 Immutable org bind for Google `sub` (invariant)

1. **First successful login** permanently binds `(provider='google', subject=sub)` to exactly one `organization_id` (the org resolved from that login’s verified `hd`). Store this on `external_identities.organization_id` and set `users.primary_organization_id` once.
2. **Re-login:** after token verify, if `claims.hd` resolves to a **different** org than `external_identities.organization_id` → **generic `AUTH_FAILED`**. Do **not** update `primary_organization_id`, do **not** add memberships.
3. Login **never** performs org transfer or additional memberships beyond the first-login bind.
4. **Org transfer / multi-org** = future admin scope (out of this slice).
5. **Session resolve (every request):** require `users.status=active`, `organizations.status=active`, and a current `organization_memberships` row for `(session.organization_id, session.user_id)`. If membership was removed → **401** even if session Cookie still valid / unexpired.
6. **Concurrent first login** (same `sub`, two parallel `/v1/auth/google`): all org/user/identity/membership/session writes occur in **one sync SQLite transaction** with uniqueness on `(provider, subject)`; exactly one user/identity; second TX observes existing identity (no duplicate users). **Required test.**

### 6.3 Org resolution from `hd` (first login only)

- Allow-list: `R1_ALLOWED_HOSTED_DOMAINS` (+ seed `organization_domains` at boot).
- First login: auto-create org+domain for allowed hd if missing (`name = hd`).
- Missing / mismatched / not allow-listed hd → `AUTH_FAILED`.

### 6.4 Stub project compatibility

Stub-mode projects (`user-a` / `org-demo`) remain stub-only. Google-mode BOLA uses Cookie-created users/orgs.

## 7. Cookies, CSRF, Origin, expiry

### 7.1 Session cookie

| Attribute | Value |
|---|---|
| Name | `blocksync_session` |
| Value | `randomBytes(32).toString("base64url")` (≥256-bit) |
| HttpOnly | `true` |
| Secure | guarded (§5) |
| SameSite | `Lax` |
| Path | `/` |
| Max-Age | e.g. 7 days absolute |

### 7.2 CSRF cookie (chosen supply method)

**Double-submit Cookie + DB hash** (restart-/reload-safe; no plaintext CSRF in DB):

| Attribute | Value |
|---|---|
| Name | `blocksync_csrf` |
| Value | raw CSRF (`randomBytes(32).toString("base64url")`) |
| HttpOnly | **`false`** (JS/SPA may read if needed; primary transport = request header mirrored from cookie) |
| Secure | **same as session cookie** |
| SameSite | `Lax` |
| Path | `/` |
| Max-Age | aligned with session |

DB stores only `sha256(rawCsrf)`. Clients send `X-CSRF-Token: <raw>` matching the CSRF cookie value. Server checks `sha256(header) === sessions.csrf_hash` **and** (defense in depth) header equals Cookie `blocksync_csrf` when both present.

`/v1/auth/me` returns user profile + `expiresAt` but **does not** need to reconstruct CSRF from the hash — the browser already has `blocksync_csrf`. Me may omit `csrfToken` JSON (cookie is source of truth after reload).

Login rotates **both** session and CSRF cookies (session fixation).

### 7.3 Route CSRF / Origin matrix

| Route | Session | CSRF | Origin |
|---|---|---|---|
| `POST /v1/auth/google` | no | **no** | **Required**; must be in `R1_ALLOWED_ORIGINS`. Missing / `null` / disallowed → **403** |
| `GET /v1/auth/me`, `GET` project reads | yes | no | n/a (safe) |
| `POST /v1/auth/logout` | yes | **yes** | **Required** allow-list; missing/null/disallowed → **403** |
| Project mutations (`POST/PUT` create/save/snapshot/restore) | yes | **yes** | **Required** allow-list; missing/null/disallowed → **403** |

`/v1/auth/google` additional gates:

- `Content-Type` must be `application/json` (charset optional)
- CORS: reflect only allow-listed origins; no `*` with credentials
- Body size limit (reuse server limits)

**Do not** use “validate Origin only if present” for browser mutating APIs or login.

### 7.4 Cookie clearing

Logout (and auth failure clear) must `Set-Cookie` clear with the **same** `Secure`, `SameSite`, and `Path` as issuance (`Max-Age=0` / empty value) for **both** `blocksync_session` and `blocksync_csrf`. **HTTP test required.**

### 7.5 Expiry & revocation

Expired / `revoked_at` set / membership missing / user or org inactive → 401. Logout revokes + clears both cookies.

## 8. AuthContext

```typescript
export interface AuthRequestHints {
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string | undefined>;
}
export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  displayName?: string; // may be null/omit when unset; not Google-name-synced this slice
}
export interface AuthContext {
  resolve(request: AuthRequestHints): Promise<AuthPrincipal>;
}
```

`SessionAuthContext` ignores spoof headers; enforces membership on every resolve.

## 9. API contract

### 9.1 `POST /v1/auth/google`

Body: `{ "idToken": "<GIS credential>" }`.

Success `200`:

```json
{
  "user": {
    "id": "...",
    "organizationId": "...",
    "email": "..."
  },
  "expiresAt": "ISO-8601"
}
```

Set-Cookie: session + csrf. No raw session id in JSON. No `csrfToken` JSON field required (cookie carries it).

Failure: `401` `{ "code": "AUTH_FAILED" }` or Origin/CT failures `403`/`400` as appropriate — never leak `VerifyFailureCode`.

### 9.2 `GET /v1/auth/me`

Session Cookie required. Returns user + `expiresAt`. `401` if invalid.

### 9.3 `POST /v1/auth/logout`

Session + CSRF + Origin. `204` + clear both cookies with matching attributes.

### 9.4 Project routes

Google mode: session Cookie; mutations need CSRF + Origin; ignore spoof headers.

### 9.5 Display name / Google `name` claim

- **Do not** modify `@blocksync/google-identity` claim surface in this slice.
- **Do not** populate `displayName` from Google ID token (no `name` on `GoogleIdentityClaims`).
- Optional: persist/update `email` from `claims.email` only; `displayName` remains null/optional local field for later slices.

### 9.6 `authorizedParties` / `azp`

| Env | Behavior |
|---|---|
| `R1_GOOGLE_AUTHORIZED_PARTIES` unset / empty | Pass **no** `authorizedParties` to verifier (azp **not** enforced) — acceptable for simple GIS ID-token-only web client where `aud` alone matches Client ID |
| Set (comma-separated Client IDs) | Pass as `authorizedParties`; verifier enforces `azp` when present |

Document in runbook: if the GIS deployment uses multiple authorized parties, set the env; otherwise leave unset. Boot may warn if google mode and parties empty (non-fatal).

## 10. Entropy

Production generators (not DI):

```typescript
randomBytes(32).toString("base64url")  // session id and CSRF raw
```

Tests may DI a deterministic generator; production bootstrap **must not** use a weak `randomId(): string` without 256-bit entropy.

## 11. Threat model (delta)

| Threat | Mitigation |
|---|---|
| CSRF after reload / restart | Non-HttpOnly CSRF Cookie survives; DB stores hash only |
| CSRF-less login abuse | Strict Origin + JSON CT + CORS on `/auth/google` |
| Silent Origin skip | Missing/null/bad Origin rejected on browser mutating + login |
| Cross-tenant via hd change | Immutable sub→org bind; mismatch → AUTH_FAILED |
| Stale membership | Resolve checks membership every time |
| Dual first-login race | Single sync TX + UNIQUE(provider,subject) |
| Cookie clear attr mismatch | Explicit clear test |
| Weak ids | `randomBytes(32)` fixed |

## 12. Verification matrix

### 12.1 Fixture (blocking Technical Go)

Prior list **plus:**

- CSRF Cookie present after login; after process restart, mutating API succeeds with same cookies (no `/me` plaintext csrf reconstruction)
- `/v1/auth/google` without Origin → 403; wrong Origin → 403; with CSRF header alone still works without prior CSRF (login has no CSRF)
- Mutation without Origin → 403 even with valid session+csrf
- Same `sub` + different allow-listed `hd` on re-login → AUTH_FAILED; user/org unchanged
- Membership deleted → existing session → 401
- Concurrent dual first-login → one user/identity
- Cookie clear uses same Secure/SameSite/Path
- `email` may update; `displayName` not required from Google
- azp: with `authorizedParties` set, bad azp rejected (via verifier)

### 12.2 Real GIS

Unchanged: optional smoke; Final Go needs evidence; else conditional Technical Go.

## 13. Review checklist

- [x] Approach A direction retained  
- [ ] CSRF Cookie + route matrix + mandatory Origin  
- [ ] Immutable sub→org bind + membership-on-resolve  
- [ ] Single-connection ownership + migrate order  
- [ ] FK/CHECK/PRAGMA; session→membership composite FK  
- [ ] `randomBytes(32)` + azp policy + no Google `name` sync  
- [ ] Cookie clear attribute HTTP test  
- [ ] Ready for implementation after approval  
