# Classroom Roster & Drive Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan **one PR at a time**. Each PR is a separate branch from latest `main`, its own CI gate, and its own Codex review cycle. Steps use checkbox (`- [ ]`) syntax for tracking.

**Case ID:** `classroom-roster-drive-submissions`

**Goal:** Add optional classroom roster (Google Sheet source of truth), student local auth, and teacher Drive submission collection on top of Phase 2 admin-student-access — without breaking anonymous `/s/{token}` links or Community `/` editing when all feature flags are OFF.

**Architecture:** Four sources of truth — **Google Sheet** (roster fields), **Railway SQLite** (`ADMIN_DB_PATH`; auth/submission metadata mirror only), **Google Drive** (`drive.file` only; submitted `.sb3` bytes), **IndexedDB** (WIP projects). **Student grant** (`syncratch_student_grant`, Phase 2) and **student identity** (`syncratch_student_identity`, PR 6+) are separate sessions. Contracts live in `@blocksync/classroom-access`; persistence and HTTP in `apps/collab-host`.

**Design:** `docs/superpowers/specs/2026-08-02-classroom-roster-drive-submissions-design.md`

**Baseline:** `main @ e51051d` (`docs: record PR #197 merge on main — admin Phase 2 complete`)

**Tech Stack:** TypeScript 5.8, pnpm workspace, Vitest, better-sqlite3, Hono/collab-host, `@blocksync/classroom-access`, `csv-parse@7.0.1`, `exceljs@4.4.0` (devDependency spike only in PR 1).

---

## Global constraints

- **Phase 2 compatibility:** When every classroom feature flag is OFF, `/`, `/admin`, `/s/{token}`, `POST /api/student/grant`, and `GET /api/student/policy` behave exactly as after PR #197. No cookie renames, no URL changes, no new required headers.
- **No School track revival:** Do not import or require `r1-persist-server`, `workspace-directory`, Person/enrollment RBAC, or frozen roster import from the R1 track.
- **No payload in SQLite:** Never store ProjectDocument, Yjs state, SB3 bytes, API keys, enrollment codes, or passphrases in plaintext.
- **Google OAuth scope:** `https://www.googleapis.com/auth/drive.file` only for teacher credential and existing editor Drive. No `drive`, `drive.readonly`, Classroom, or Gmail scopes.
- **StudentPolicyView:** Never expose `rosterId`, admin emails, other link tokens, or teacher credentials to student clients.
- **Feature flags default OFF:** Runtime behavior changes only when the corresponding flag chain is explicitly enabled.
- **8 PR rule:** Each PR merges independently; later PRs must not be bundled into earlier PRs.
- **Handoff:** Stop at `READY_FOR_CODEX_REVIEW` per PR. **Do not auto-merge.** User/Codex review precedes merge to `main`.
- Do not touch or stage `docs/ai-platform/`.

---

## Feature flags (all default OFF)

Parsed by `parseClassroomFeatureFlags()` in `@blocksync/classroom-access`. Startup must call `validateClassroomFeatureFlagDependencies()` and **fail closed** when the chain is broken (collab-host startup error or admin API 503 — choose in PR 2).

| Flag | Environment variable | Depends on |
|---|---|---|
| `classroomRosterEnabled` | `SYNCRATCH_CLASSROOM_ROSTER_ENABLED` | — |
| `adminGoogleCredentialEnabled` | `SYNCRATCH_ADMIN_GOOGLE_CREDENTIAL_ENABLED` | `classroomRosterEnabled` |
| `rosterSheetsEnabled` | `SYNCRATCH_ROSTER_SHEETS_ENABLED` | `adminGoogleCredentialEnabled` |
| `studentLocalAuthEnabled` | `SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED` | `classroomRosterEnabled` |
| `teacherDriveSubmissionEnabled` | `SYNCRATCH_TEACHER_DRIVE_SUBMISSION_ENABLED` | `studentLocalAuthEnabled` |
| `submissionPreviewEnabled` | `SYNCRATCH_SUBMISSION_PREVIEW_ENABLED` | `teacherDriveSubmissionEnabled` |

**Flag OFF public behavior:**

- New routes (`/api/admin/rosters`, `/api/student/auth/*`, `/api/student/submissions`, etc.) return **404 or 501** (unregistered).
- PR 1 migration adds schema only; existing `classroom_policies` rows keep `roster_id = NULL`, `student_auth_required = 0`, `submission_enabled = 0`.
- No `syncratch_student_identity` cookie is issued.

---

## Admin SQLite migration ledger

Pattern mirrors `packages/project-store-sqlite` ledger slice, adapted for `apps/collab-host/src/admin-db-migrations/`.

| Version | Name | Scope |
|---|---|---|
| 1 | `admin-phase2-baseline` | Phase 2 tables + `editor_allow_extensions` adoption |
| 2 | `classroom-roster-foundation` | PR 1 — roster/student/import/audit tables + policy columns |
| 3+ | (later PRs) | e.g. `classroom_submissions` in PR 7, admin Google credential storage in PR 2 |

**Ledger table:** `schema_migrations(version, name, checksum, applied_at)`

**Invariants:**

- `PRAGMA user_version` must equal the highest ledger row version after successful startup.
- Registry validates version sequence (1…N), unique names, and `checksum === SHA-256(checksumSource)`.
- Phase 2 ledgerless DBs classify as `phase2_current` and adopt v1 without DDL replay; v2 applies additively.
- Unknown/partial schemas, ledger gaps, checksum mismatches, and future versions **fail closed** with no partial writes.
- Migration callbacks are synchronous; no Promise, nested transaction, or second `Database()` inside a migration.
- Configure WAL, foreign keys, and busy timeout before migration transactions.
- Runtime down-migration is prohibited.

**PR 1 wiring:** `openAdminDb()` calls `runAdminDbMigrations(db, ADMIN_DB_MIGRATIONS)` on startup instead of inline DDL.

---

## CSV adoption and XLSX gate (PR 1)

### CSV — production parser (`csv-parse@7.0.1`)

Adopted in `apps/collab-host/package.json` as a runtime dependency. Gate contract in `roster-import-csv.test.ts`:

```ts
parse(csv, {
  columns: true,
  skip_empty_lines: true,
  bom: true,
  relax_quotes: true,
});
```

- Header names must match `ROSTER_SHEET_COLUMNS` from `@blocksync/classroom-access`.
- `attendance_number` must remain a string (leading zeros preserved; never numeric-coerce).
- Quoted newlines inside `display_name` must parse correctly.
- Formula-leading cells must be neutralized on export (PR 3 apply path).

### XLSX — safety spike only (`exceljs@4.4.0` devDependency)

PR 1 runs spike tests only; **no production XLSX import route** until PR 3+ evaluates Go/No-Go from measured evidence.

| Gate | Limit |
|---|---|
| File size | ≤ 2 MiB |
| Worksheets | exactly 1 |
| Data rows | ≤ 1000 (excluding header) |
| Columns | ≤ 20 |
| Read timeout | 5 s |
| RSS delta (spike observation) | < 96 MiB on representative workbook |
| Formula cells | **reject** (`formula_rejected`) |
| Malformed zip | throw; **process must survive** |

If PR 3 cannot meet gates under CI memory limits, ship CSV-only import and record XLSX as No-Go in the handoff ledger.

---

## PR overview

| PR | Status | Primary deliverable | Flags required for behavior |
|---|---|---|---|
| **1** | **IN PROGRESS — this PR** | Contracts, migration v2, flags, CSV/XLSX gate tests | none (all OFF) |
| 2 | NOT STARTED | Admin Google OAuth credential (`drive.file`) | `CLASSROOM_ROSTER` + `ADMIN_GOOGLE_CREDENTIAL` |
| 3 | NOT STARTED | Roster/student admin API + CSV import preview/apply | `CLASSROOM_ROSTER` |
| 4 | NOT STARTED | Google Sheet sync | + `ROSTER_SHEETS` |
| 5 | NOT STARTED | Policy ↔ roster link + student surface auth gate | `CLASSROOM_ROSTER` |
| 6 | NOT STARTED | Student activate/login/logout + identity cookie | + `STUDENT_LOCAL_AUTH` |
| 7 | NOT STARTED | Submission upload (SB3 → teacher Drive + SQLite meta) | + `TEACHER_DRIVE_SUBMISSION` |
| 8 | NOT STARTED | Teacher submission list/detail/preview UI | + `SUBMISSION_PREVIEW` |

---

# PR 1 — Foundation (contracts, migration ledger, flags, import gate)

**Status:** **IN PROGRESS / this PR**

**Scope:** Freeze contracts and admin DB migration v2. Add feature-flag definitions and dependency validation. Prove CSV parse and XLSX safety gates in tests. **No new HTTP routes, no UI changes, no OAuth, no runtime behavior change** with flags OFF.

### Files

| Path | Action |
|---|---|
| `docs/superpowers/specs/2026-08-02-classroom-roster-drive-submissions-design.md` | Create — authoritative design |
| `docs/superpowers/plans/2026-08-02-classroom-roster-drive-submissions-plan.md` | Create — this plan |
| `packages/classroom-access/src/roster-types.ts` | Create — roster/submission/import contracts |
| `packages/classroom-access/src/feature-flags.ts` | Create — flag parse + dependency validation |
| `packages/classroom-access/src/feature-flags.test.ts` | Create |
| `packages/classroom-access/src/paths.ts` | Modify — admin/student path constants (contract only) |
| `packages/classroom-access/src/types.ts` | Modify — `rosterId`, `studentAuth`, `submission` on policy |
| `packages/classroom-access/src/policy.ts` | Modify — normalize/merge defaults |
| `packages/classroom-access/src/index.ts` | Modify — exports |
| `packages/classroom-access/src/index.test.ts` | Modify — policy default assertions |
| `apps/collab-host/src/admin-db-migrations/` | Create — ledger runner, v1 baseline, v2 foundation |
| `apps/collab-host/src/admin-db.ts` | Modify — wire `runAdminDbMigrations`, map new policy columns |
| `apps/collab-host/src/roster-import-csv.test.ts` | Create — `csv-parse@7.0.1` gate |
| `apps/collab-host/src/roster-import-xlsx-spike.test.ts` | Create — `exceljs` safety spike |
| `apps/collab-host/package.json` | Modify — add `csv-parse@7.0.1`, dev `exceljs@4.4.0` |
| `pnpm-lock.yaml` | Update |

### APIs (contract constants only — **not registered in collab-host**)

Path constants exported from `@blocksync/classroom-access` for later PRs:

- Admin: `/api/admin/rosters`, `/api/admin/students`, `/api/admin/google/oauth/*`, roster import preview/apply paths, submission admin paths
- Student: `/api/student/auth/activate`, `/login`, `/session`, `/logout`, `/api/student/submissions`

### Verification

```text
pnpm --filter @blocksync/classroom-access test
pnpm --filter @blocksync/classroom-access typecheck
pnpm --filter @blocksync/collab-host test -- src/admin-db-migrations/migration.test.ts
pnpm --filter @blocksync/collab-host test -- src/roster-import-csv.test.ts
pnpm --filter @blocksync/collab-host test -- src/roster-import-xlsx-spike.test.ts
pnpm --filter @blocksync/collab-host typecheck
git diff --check
```

**Must pass:**

- Fresh DB reaches ledger versions `[1, 2]`, `user_version = 2`.
- Phase 2 ledgerless fixture adopts v1 then applies v2; existing policy rows keep `editor.allowExtensions === true`, `studentAuth.required === false`, `submission.enabled === false`.
- `toStudentPolicyView()` omits `rosterId`.
- All flags unset → all false; broken dependency chain → non-empty `validateClassroomFeatureFlagDependencies()`.
- CSV: 6-column contract, leading zero attendance, quoted newline in name.
- XLSX: small workbook OK; formula rejected; corrupt zip does not crash process.

### Prohibitions

- Do **not** register new Hono routes in `apps/collab-host/src/server.ts`.
- Do **not** change `/admin` or `/s` HTML/SPA or `apps/editor-web` student surface.
- Do **not** implement Google OAuth callback, Sheet sync, enrollment issuance, or submission upload.
- Do **not** create `classroom_submissions` table (deferred to PR 7 migration v3).
- Do **not** enable any feature flag by default or in Railway template env.
- Do **not** import from frozen School packages.

### PR 1 handoff

- Update `docs/CURSOR_CODEX_HANDOFF.md` with case ID, base SHA `e51051d`, head SHA, test summary.
- Set handoff state to **`READY_FOR_CODEX_REVIEW`**.
- Open PR; wait for CI green and Codex GO.
- **Do not auto-merge.**

---

# PR 2 — Admin Google OAuth credential

**Status:** NOT STARTED

**Scope:** Separate teacher Google credential session (`syncratch_admin_google` proposed) with **`drive.file` scope only**. Connect/disconnect/status APIs gated by `SYNCRATCH_CLASSROOM_ROSTER_ENABLED` + `SYNCRATCH_ADMIN_GOOGLE_CREDENTIAL_ENABLED`. Store encrypted refresh token server-side. Fail closed on flag dependency violations at collab-host startup.

### Files (expected)

| Path | Action |
|---|---|
| `apps/collab-host/src/admin-google-oauth.ts` | Create |
| `apps/collab-host/src/admin-google-oauth.test.ts` | Create |
| `apps/collab-host/src/admin-db-migrations/0003-admin-google-credential.ts` | Create (credential storage table) |
| `apps/collab-host/src/server.ts` | Modify — register OAuth routes behind flags |
| `apps/collab-host/src/admin-db-migrations/index.ts` | Modify — register v3 |
| `docs/local-first/DEPLOYMENT.md` | Modify — document env + OAuth redirect |

### APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/google/oauth/start` | Begin OAuth (admin session required) |
| GET | `/oauth/admin-google/callback` | OAuth callback |
| GET | `/api/admin/google/oauth/session` | Credential status |
| POST | `/api/admin/google/oauth/disconnect` | Revoke stored credential |

### Verification

- Flag OFF → routes 404/501; no `syncratch_admin_google` cookie.
- Flag ON + valid admin session → OAuth round-trip stores credential; scope request contains only `drive.file`.
- Admin login cookie alone does **not** imply teacher credential.
- Migration v3 applies cleanly from v2; ledger `[1,2,3]`.
- `@blocksync/classroom-access` + `@blocksync/collab-host` tests green; `git diff --check` PASS.

### Prohibitions

- No Sheet read/sync (PR 4).
- No roster CRUD routes (PR 3).
- No reuse of editor `syncratch_drive_session` cookie for admin credential.
- No broad Drive or Classroom scopes.

---

# PR 3 — Roster admin API and CSV import

**Status:** NOT STARTED

**Scope:** CRUD for rosters and students, bounded CSV upload → validate → preview → atomic apply with `preview_hash` + `base_roster_revision` CAS. Audit writes in same transaction. Gated by `SYNCRATCH_CLASSROOM_ROSTER_ENABLED`.

### Files (expected)

| Path | Action |
|---|---|
| `apps/collab-host/src/roster-service.ts` | Create |
| `apps/collab-host/src/roster-import.ts` | Create — uses `csv-parse@7.0.1` |
| `apps/collab-host/src/roster-routes.ts` | Create |
| `apps/collab-host/src/roster-*.test.ts` | Create |
| `apps/collab-host/src/server.ts` | Modify — register routes behind flag |

### APIs

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/admin/rosters` | List/create rosters |
| GET/PATCH/DELETE | `/api/admin/rosters/{rosterId}` | Roster detail |
| GET | `/api/admin/rosters/{rosterId}/students` | List students |
| POST | `/api/admin/rosters/{rosterId}/imports` | Upload CSV |
| GET | `/api/admin/rosters/{rosterId}/imports/{importId}` | Import status |
| GET | `/api/admin/rosters/{rosterId}/imports/{importId}/preview` | Preview rows |
| POST | `/api/admin/rosters/{rosterId}/imports/{importId}/apply` | Atomic apply |

### Verification

- Flag OFF → 404/501 on all roster routes; Phase 2 admin policy/link tests unchanged.
- Valid CSV → preview categories (`add`, `update`, `deactivate`, collisions, `rejected_row`).
- Stale `preview_hash` or revision → apply rejected; DB unchanged.
- Concurrent apply → one winner; loser gets conflict.
- `attendance_number` leading zeros preserved end-to-end.
- Audit row per applied mutation.

### Prohibitions

- No Google Sheet API calls (PR 4).
- No student auth routes (PR 6).
- No partial apply on validation failure.
- No email-based auto-linking of students to Google accounts.
- XLSX upload route only if PR 1 XLSX gate evidence is GO.

---

# PR 4 — Google Sheet sync

**Status:** NOT STARTED

**Scope:** Bind roster to `sheetSpreadsheetId`, `sheetTabName`, `sheetRange`. Manual `POST .../sync` pulls Sheet via teacher credential, diffs against SQLite mirror, bumps `roster_revision`, sets `sync_status` (`active` | `sync_required`). Gated by `SYNCRATCH_ROSTER_SHEETS_ENABLED`.

### Files (expected)

| Path | Action |
|---|---|
| `apps/collab-host/src/roster-sheet-sync.ts` | Create |
| `apps/collab-host/src/roster-sheet-sync.test.ts` | Create |
| `apps/collab-host/src/roster-routes.ts` | Modify — sync endpoint |

### APIs

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/rosters/{rosterId}/sync` | Pull Sheet → SQLite mirror |

### Verification

- Requires teacher credential (PR 2); returns 409/503 when credential missing.
- Sheet columns match `ROSTER_SHEET_COLUMNS`; unknown columns ignored or rejected per design.
- Revision CAS on concurrent sync.
- Flag OFF → sync route unavailable.
- No webhook/cron in this PR (manual sync only).

### Prohibitions

- No automatic polling or push notifications.
- No two-way write-back to Sheet.
- No project payload in Sheet cells.

---

# PR 5 — Policy ↔ roster binding and student surface gate

**Status:** NOT STARTED

**Scope:** Admin can set `ClassroomPolicy.rosterId` and `studentAuth.required`. Student surface after grant exchange shows login/activate **shell UI** when required (no identity cookie yet). `shared-anonymous` mode unchanged when `rosterId` null or `studentAuth.required === false`.

### Files (expected)

| Path | Action |
|---|---|
| `apps/collab-host/src/admin-db.ts` | Modify — policy patch validation (roster ownership) |
| `apps/collab-host/src/server.ts` | Modify — enforce roster-login gate on student policy response |
| `apps/editor-web/src/student-auth-gate.ts` | Create (or extend student surface bootstrap) |
| `apps/editor-web/src/student-auth-gate.test.ts` | Create |

### APIs

- Extend existing `PATCH /api/admin/policies/{policyId}` with `rosterId`, `studentAuth`.
- `GET /api/student/policy` returns `studentAuth.required` (already in view); client gate only.

### Verification

- Flag OFF → policies remain `rosterId=null`, `studentAuth.required=false`; student surface identical to Phase 2.
- Flag ON + required auth → editor hidden until login UI shown (identity API still 501 until PR 6).
- Invalid cross-admin `rosterId` → 404 existence hiding.
- `toStudentPolicyView` still omits `rosterId`.

### Prohibitions

- Do **not** issue `syncratch_student_identity` cookie (PR 6).
- Do **not** break anonymous link flow when auth not required.
- Do **not** expose roster membership lists to student clients.

---

# PR 6 — Student local auth (identity session)

**Status:** NOT STARTED

**Scope:** Enrollment code issuance (admin), activate/login/logout/session APIs, `syncratch_student_identity` cookie. Passphrase hashing (Argon2id or scrypt). Identity requires valid grant + matching `policy.rosterId` membership. Gated by `SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED`.

### Files (expected)

| Path | Action |
|---|---|
| `apps/collab-host/src/student-auth.ts` | Create |
| `apps/collab-host/src/student-auth.test.ts` | Create |
| `apps/collab-host/src/student-auth-routes.ts` | Create |
| `apps/editor-web/src/student-auth-ui.ts` | Create |
| `apps/collab-host/src/server.ts` | Modify |

### APIs

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/student/auth/activate` | Enrollment code + passphrase → identity |
| POST | `/api/student/auth/login` | loginName + passphrase → identity |
| GET | `/api/student/auth/session` | Identity status |
| POST | `/api/student/auth/logout` | Clear identity |
| POST | `/api/admin/students/{studentId}/enrollment-code` | Issue code (once display) |
| POST | `/api/admin/students/{studentId}/reset-code` | Reset passphrase flow |
| POST | `/api/admin/students/{studentId}/sessions/revoke` | Revoke identity sessions |

### Verification

- Flag OFF → auth routes 404/501; no identity cookie.
- Activate → `active`; bad code → generic failure; hashed storage only.
- Identity without grant → 401.
- Identity `student_id` not in policy roster → 403.
- Grant expiry → identity invalid on next request.
- Login accepts `login_name` or fallback `student_code`.

### Prohibitions

- No Google OAuth for students.
- No plaintext enrollment code or passphrase in logs/DB.
- Do **not** conflate identity cookie with `syncratch_student_grant`.
- No submission upload (PR 7).

---

# PR 7 — Teacher Drive submission (upload path)

**Status:** NOT STARTED

**Scope:** Migration v3 adds `classroom_submissions`. Student `POST /api/student/submissions` uploads SB3 via server using **teacher** credential into pre-selected folder. SQLite stores metadata + SHA256 only. Policy `submission.enabled` + flag required. WIP stays in IndexedDB.

### Files (expected)

| Path | Action |
|---|---|
| `apps/collab-host/src/admin-db-migrations/0004-classroom-submissions.ts` | Create |
| `apps/collab-host/src/submission-service.ts` | Create |
| `apps/collab-host/src/submission-routes.ts` | Create |
| `apps/editor-web/src/student-submission-ui.ts` | Create |
| `apps/collab-host/src/server.ts` | Modify |

### APIs

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/student/submissions` | Upload SB3 (identity + grant + policy checks) |
| GET | `/api/admin/policies/{policyId}/submissions` | Teacher list (metadata) |
| GET | `/api/admin/submissions/{submissionId}` | Detail |
| GET | `/api/admin/submissions/{submissionId}/content` | Stream SB3 from Drive |

### Verification

- Flag OFF → submission routes 404/501.
- roster-login: no identity → 401 on submit.
- `submission.enabled=false` → 403.
- Drive file created only under teacher-configured folder; student cannot supply arbitrary folderId.
- SQLite row has no SB3 bytes; SHA256 matches uploaded content.
- Resubmission sets `isResubmission` per design.
- Phase 2 anonymous editing still works when submission disabled.

### Prohibitions

- No SB3 bytes in SQLite or audit payload JSON.
- No student Drive OAuth for server-side submission path.
- No automatic submit on save; explicit user action only.
- No preview UI (PR 8).

---

# PR 8 — Teacher submission list and preview surface

**Status:** NOT STARTED

**Scope:** `/admin` UI for submission list/detail; optional preview surface at `/admin/submissions/{id}/preview` gated by `SYNCRATCH_SUBMISSION_PREVIEW_ENABLED`. Fetch SB3 from Drive through admin session + teacher credential.

### Files (expected)

| Path | Action |
|---|---|
| `apps/collab-host/src/admin-submissions-ui.ts` | Create (or admin SPA module) |
| `apps/collab-host/static/admin/` or embedded admin routes | Modify |
| `apps/editor-web/` or admin host | Preview embed (read-only) |
| `docs/local-first/DEPLOYMENT.md` | Update operator docs |

### APIs / surfaces

| Path | Purpose |
|---|---|
| `/admin` submissions panel | List/filter by policy |
| `/admin/submissions/{submissionId}/preview` | Read-only SB3 preview |
| Existing admin submission JSON APIs from PR 7 | Wired into UI |

### Verification

- Preview flag OFF → preview route 404; list still works if submission flag ON.
- Preview loads project read-only; no persist back to IndexedDB/Drive.
- Teacher without credential → clear error, no token leakage.
- Playwright/manual: list → detail → preview happy path.
- Full regression: flags OFF → Phase 2 E2E green.

### Prohibitions

- No student access to preview surface.
- No write/autosave from preview.
- No merge of PR 7 and PR 8 — PR 7 must stand alone with API-only teacher flow.

---

## Cross-PR regression gates

After **every** PR merge to `main`:

```text
pnpm --filter @blocksync/classroom-access test
pnpm --filter @blocksync/classroom-access typecheck
pnpm --filter @blocksync/collab-host test
pnpm --filter @blocksync/collab-host typecheck
pnpm --filter @blocksync/editor-web test
pnpm --filter @blocksync/editor-web typecheck
pnpm gate0:test
git diff --check
```

With **all classroom flags unset**, additionally confirm:

- `POST /api/student/grant` + `GET /api/student/policy` behavior matches Phase 2.
- Community `/` editor settings still writable to localStorage.
- No new cookies besides Phase 2 grant on student surface.

---

## Handoff and merge policy

Each PR completes with:

1. Working tree clean (or documented intentional unstaged docs only for PR 1 plan/spec pair).
2. CI green on the PR branch.
3. `docs/CURSOR_CODEX_HANDOFF.md` entry: case ID, base/head SHA, test commands + results, known limits.
4. Handoff state **`READY_FOR_CODEX_REVIEW`** — next assignee **Codex**.
5. **No auto-merge.** Merge only after Codex GO (or explicit user instruction matching workspace merge rules).

**PR 1 stop condition:** Land spec + plan + foundation code; set `READY_FOR_CODEX_REVIEW`; **do not** start PR 2 on the same branch.

---

## Plan completion gate (full case)

- All 8 PRs merged; each shipped with flags OFF by default.
- Sheet roster, local student auth, and teacher Drive submission work when flag chain enabled.
- Four sources of truth respected; SQLite never holds SB3 bytes.
- `student grant` and `student identity` remain separate cookies and validation paths.
- Phase 2 anonymous links and Community `/` unchanged with flags OFF.
- Codex adversarial review passed for each PR before merge.
