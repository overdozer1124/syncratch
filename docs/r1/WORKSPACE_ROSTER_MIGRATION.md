# R1 Legacy-to-Workspace Migration Policy

## Status and scope

This document freezes the legacy R1 input-to-target policy consumed by the next detailed plan for the versioned migration ledger and Workspace target schema. It is a policy contract only: it does not define or implement the target schema, a migration runner, directory services, authentication cutover, roster claims, APIs, or UI.

The immutable source evidence is the committed legacy database, manifest, and snapshot blobs under `packages/project-store-sqlite/src/fixtures/`. Tests copy that fixture before opening it and pin the raw revision JSON, content and request hashes, client transaction IDs, snapshot metadata, and snapshot blob SHA-256 values.

## Frozen migration matrix

| Legacy input | Target rule | Immutable evidence |
|---|---|---|
| `organizations.id` | Create `workspaces` row with identical ID; keep physical organization row during R1 | organization ID |
| `users` | Create one account and one Person/`PersonAccountLink`; Person ID strategy is fixed by the next schema plan | user ID and status |
| `organization_memberships` | Create equivalent workspace membership without adding roles | membership set |
| `external_identities` | Remove workspace binding only when account migration lands | `(provider, subject)` and user ID |
| `sessions` | Revoke or migrate fail-closed; never grant another workspace | session hash and revocation outcome |
| `projects.organization_id` | Backfill `workspace_id` with same value | project ID and owner |
| `project_revisions` | Never update rows | raw envelope JSON, hashes, transaction IDs |
| `project_snapshots` + blobs | Never rewrite | metadata and blob SHA-256 |
| asset grant/quota rows | Interpret legacy organization ID as workspace ID until explicit FK migration | SHA/grant set |

## Invalid-input policy

Invalid input is handled fail-closed. Any abort leaves the migration unapplied; it must not synthesize identity, rewrite immutable evidence, or widen access.

- Missing organization/user referenced by a legacy project: migration aborts with actionable IDs; no synthetic identity is created.
- Session without valid membership: revoke fail-closed.
- Envelope `organizationId` differing from project tenant: migration aborts; do not rewrite envelope.
- Invalid legacy role: migration aborts; do not widen permission.

## Requirements for the next migration plan

The next detailed plan must turn this policy into transactional acceptance tests before implementing production migration behavior. It must define the Person ID strategy, versioned ledger and target Workspace schema while preserving the same-ID tenant mapping and all immutable evidence above. Directory services, auth cutover, roster claims, APIs, and UI remain out of scope until that migration plan is approved.
