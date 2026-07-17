# Release 1 Slice — Workspace, Roster & Scoped Access Design

> **Status:** Approved in design dialogue — written-spec review pending; implementation not started
>
> **Baselines:** R1 persistence Technical Go @ `3d6053b`; R1 auth Technical Go — real GIS conditional @ `570e237`; Scratch/SB3 Technical Go @ `357bb3f`
>
> **Master specification:** `docs/specification/BlockSync-AI_システム仕様書・実装計画書_v1.2.md`

## 1. Decision

School, academic year, grade, class, attendance number, roster, staff assignment and scoped authorization are Release 1 foundation, not a later school add-on.

The schema, services, APIs and minimal management UI ship in this slice. Their **use remains optional**: personal and casual workspaces do not require school or class data, and a project may exist without a class.

This slice supersedes the product-facing single-organization assumption of the approved auth slice. The old verdict and evidence remain valid for that completed slice; migration must preserve existing databases, sessions' security properties and frozen V1 project hashes.

## 2. Goals

1. Separate roster identity (`Person`) from authentication identity (`UserAccount`).
2. Allow one person/account to participate in multiple workspaces.
3. Support `personal`, `casual` and `school` workspaces from the same model.
4. Provide School → AcademicYear → Grade → ClassGroup and historical enrollment/staff assignment from the first usable release.
5. Let one teacher be System Owner, Workspace Owner and Teacher without creating artificial enterprise roles.
6. Allow school/class-free projects and later student-hosted collaboration.
7. Enforce permissions by scope and capability, not by the words “teacher” or “student”.
8. Preserve BOLA protection, generic auth errors, CSRF/Origin rules, revision CAS, snapshot integrity and V1 envelope hashes.

## 3. Non-goals

- Education-board or municipality hierarchy as a prerequisite
- SIS/Classroom synchronization
- Guardian portal
- Attendance taking, grades or school administration records beyond programming use
- Public room discovery
- Unauthenticated guest collaboration in this slice; the model reserves it for the Release 3 collaboration slice
- AI provider configuration UI beyond capability placeholders

## 4. Core model

### 4.1 Identity

```text
Person 1 ── 0..* PersonAccountLink ── 1 UserAccount
UserAccount 1 ── 0..* ExternalIdentity
UserAccount 1 ── 0..* Session
```

- `Person` may be created from a roster before the pupil has an account.
- `(provider, subject)` is globally unique.
- One account cannot be linked to multiple people at the same time.
- Email equality never links records automatically.
- Link, unlink and merge are explicit, audited operations.
- Deleting or disabling an account must not cascade-delete the person, enrollment history or projects.

### 4.2 Workspace

```text
Workspace(kind: personal | casual | school)
  ├─ WorkspaceMembership
  ├─ Project
  └─ School? (only for kind=school)
```

- A new account receives a personal workspace and owner membership atomically.
- The same account may hold memberships in multiple workspaces.
- A school workspace can be created by one teacher without a parent municipality.
- Collection/create APIs take an explicit `workspaceId`; resource APIs derive workspace ownership from the resource and reject mismatches.
- A project has `workspaceId NOT NULL` and `classGroupId NULLABLE`.

### 4.3 School roster

```text
School
  └─ AcademicYear
       └─ Grade
            └─ ClassGroup
                 ├─ Enrollment(Person)
                 └─ StaffAssignment(Person)
```

Required records:

- `School`: workspace-scoped school profile
- `AcademicYear`: label, start/end date, lifecycle status
- `Grade`: year-scoped grade code, display label, sort order
- `ClassGroup`: academic year + grade + class label
- `Enrollment`: person, class, start/end date, status, nullable attendance number
- `StaffAssignment`: person, class, assignment role, start/end date
- `RosterImport` / `RosterImportRow`: uploaded intent, validation result, preview hash and apply result

Progression, transfer, graduation and class changes close old rows and create new history. They never overwrite the prior year's facts.

Attendance number is nullable. When present it is unique among overlapping active enrollments in the same class. Date overlap and uniqueness are service invariants protected in one synchronous transaction.

## 5. Scoped access

Roles are templates for capabilities; school relationships are facts.

| Scope | Roles | Representative capabilities |
|---|---|---|
| system | owner, operator | provider secrets, global limits, bootstrap/transfer |
| workspace | owner, admin, member, guest | workspace settings, members, invites |
| school | school_admin, staff, student | roster and school participation |
| class | teacher, assistant, student | class/assignment operations |
| project | owner, host, editor, commenter, viewer | project participation and collaboration |

Rules:

- `StaffAssignment` does not automatically grant System Owner.
- `Enrollment` does not automatically grant Project Host.
- Claim-code issuance requires the school-scoped `roster_claim.issue` capability; a teacher or administrator title alone is insufficient.
- The same person may explicitly hold System Owner, Workspace Owner and Teacher.
- A student may explicitly hold Project Host.
- Project Host cannot read or modify provider secrets, global budgets, roster, retention or system safety limits.
- The last active System Owner or Workspace Owner cannot remove or demote themselves without an atomic transfer.
- Every authorization decision is made server-side from durable state.
- `guest` is reserved in the capability vocabulary, but guest invitation and guest-principal flows are deferred to Release 3.

## 6. Bootstrap

Self-hosted mode uses a single-use setup secret shown once on the controlling terminal during initialization. Only its hash is stored in the database; the plaintext must not be written to a file, persistent log or audit payload. The first authenticated account atomically consuming that secret becomes System Owner; concurrent or replayed consumption fails. Hosted mode provisions System Owner through an operator-only path.

Merely selecting “teacher” or creating a school never grants system privileges.

## 7. Authentication and session migration

The existing code stores `primary_organization_id`, binds `external_identities` to one organization and makes sessions membership-scoped. The new target is:

- external identity → user account, independent of workspace
- session → user account, independent of active workspace
- resource authorization → resource workspace + durable membership/capability
- `hd` → optional evidence for a restricted school join, never an automatic admin grant or immutable tenant bind

The migration must:

1. Add versioned migrations and a `schema_migrations` ledger.
2. Add a physical `workspaces` table and convert each existing organization into a workspace while retaining its identifier.
3. Create people/account links for existing users.
4. Convert organization memberships to workspace memberships.
5. Point projects at the migrated workspace without changing frozen envelope JSON or hashes.
6. Rotate or migrate existing sessions fail-closed; no session may gain a new workspace.
7. Replace auth tests that assert immutable cross-`hd` failure with multi-workspace and explicit-join tests, while retaining signature/audience/expiry/oracle/CSRF tests.

`organizationId` inside schemaVersion 1 project envelopes remains frozen compatibility data. New code interprets it as the legacy tenant/workspace identifier. It must not be renamed or rehashed in place. A later schema version may introduce `workspaceId` explicitly.

During R1 migration, keep the physical `organizations` table and its existing foreign keys. `workspaces` is the new domain source of truth. A compatibility adapter creates or validates the paired `organizations` row with the same identifier in the same transaction when an R1 path still needs a legacy row. No compatibility view replaces `organizations`; migrations repoint foreign keys explicitly before that table can ever be retired.

### 7.1 Roster account claim

An authenticated user links their account to a roster `Person` by entering a one-time claim code issued by a principal with `roster_claim.issue`.

- Generate at least 128 bits with a cryptographically secure RNG. Store only a hash of the code, with expiry, consumed state and target person.
- Consume the code and create `PersonAccountLink` in one synchronous transaction.
- Reject replay, expiry and disabled people without revealing another account's identity.
- A code is deterministically bound to one person. “Ambiguous” means durable state already contains a conflicting active link: either the target person is linked to another account or the authenticated account is linked to another person. The claim never overrides such a link. It becomes a pending conflict that requires an authorized teacher or administrator to verify identity and resolve the old link through a separate audited operation.
- Rate-limit failed claims by authenticated account and remote source. For the initial single-node server, allow at most 10 failed attempts per account and 50 per source in 15 minutes; persist counters in SQLite so restart cannot reset the budget. Return the same public failure body for invalid, expired, consumed and throttled codes.
- Never claim or link from email equality alone.

## 8. Roster import

```text
upload/parse
  → validate and normalize
  → durable preview + previewHash
  → user reviews diff
  → idempotent apply in one sync transaction
  → audit events
```

Preview categories: add person, update display fields, new enrollment, class move, end enrollment, duplicate candidate, attendance collision, ambiguous account link and rejected row.

Apply requires the preview hash and base directory revision. A stale preview returns conflict. Any invariant failure rolls back all rows. CSV formula injection is neutralized on export; uploads have byte/row/field limits.

## 9. Minimal management UI

Management is a permission-gated route in the same product, not a separate enterprise console.

Initial screens:

1. Setup / workspace switcher
2. School and academic year
3. Grades and classes
4. Roster and enrollment history
5. Staff assignments and permissions
6. CSV preview and apply
7. Advanced system settings, visible only with system capability

Personal/casual users never see required school setup. Progressive disclosure affects presentation only; all domain capabilities above are implemented in this slice.

## 10. Project integration

- `CreateProjectInput` adds `workspaceId` and optional `classGroupId`.
- Creation verifies workspace membership, optional class access and inserts project + owner role + revision atomically.
- Project roles become owner/host/editor/commenter/viewer.
- Existing 404 existence-hiding, revision CAS, idempotent transaction and snapshot contracts remain.
- Asset grants and quota ownership follow the project's workspace. Existing V1 content hashes remain stable.

Project invitations and student-host transfer are implemented in Release 3, but the Release 1 schema and authorization vocabulary must not block them.

## 11. Persistence and migration invariants

- Use the existing shared `better-sqlite3` connection from `openSqliteStore`.
- All domain transactions are synchronous; no Promise crosses `withTransaction<T>`.
- `PRAGMA foreign_keys=ON` and WAL remain enabled.
- Migrations are monotonic, restartable and tested from a database created by the approved auth/persistence baseline.
- Existing project revisions, snapshot blobs, transaction ids and content hashes are byte-for-byte unchanged.
- Cross-workspace foreign keys and lookup indexes are explicit.
- Destructive person/enrollment deletion is not an ordinary UI operation; use disable/end/archive states.

## 12. Security and privacy

Threats to test explicitly:

- account-to-person mis-link and roster claim takeover
- first-owner bootstrap race or setup-secret replay
- cross-workspace IDOR/BOLA
- role escalation through teacher/student labels
- removal of the last owner
- expired/revoked invitation reuse
- CSV formula injection, duplicate flood and stale-preview apply
- graduation/removal with a still-open session or WebSocket

Roster access is least-privilege and audited. AI payload construction excludes name, email, attendance number and roster metadata by default.

## 13. Go conditions

1. Existing baseline DB migrates with unchanged project revision/snapshot hashes and can reopen after restart.
2. One account can own a personal workspace and participate in a school workspace.
3. A roster person can exist before login and be explicitly linked without email auto-match.
4. One teacher can bootstrap, create school/year/grade/class, register pupils and assign permissions.
5. Manual and CSV roster operations preserve history and roll back atomically on error.
6. Personal/casual project creation requires no school or class.
7. Student Project Host is representable, but has no system, secret or roster capability.
8. Cross-workspace BOLA, stale role/session and owner-removal tests pass.
9. Minimal management UI completes both teacher setup and no-school quick-start flows.
10. All prior build, Gate 0, persistence, auth and Scratch/SB3 regression gates remain green.

## 14. Stop conditions

- Migration changes any frozen V1 envelope or revision content hash.
- Account/person linking can occur solely from unverified email equality.
- Login still permanently binds a Google subject to exactly one workspace.
- Teacher/student labels directly grant system capabilities.
- Roster schema ships without APIs and usable minimal management UI.
- Personal/casual use requires school data.

## 15. Resolved implementation decisions

1. Add a physical `workspaces` table, retain every existing organization ID and keep the physical `organizations` table behind a compatibility adapter during R1.
2. Link roster people through an authenticated, one-time claim code. A conflicting active account/person link creates a pending conflict; it never auto-overrides and requires a separate audited resolution by an authorized teacher or administrator.
3. Reserve `guest` in the role/capability vocabulary, but defer invitations and guest-principal implementation to Release 3.
4. Store a one-time System Owner setup-secret hash in the database and show the plaintext secret only once during initialization.
