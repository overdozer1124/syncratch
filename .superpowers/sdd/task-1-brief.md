# Task 1: Local-First pivot specification

## Goal

Make Local-First the primary product track and freeze the existing School Server track without deleting or rewriting its implementation.

## Required decisions

- Solo editing is login-free and stores the source of truth in IndexedDB with `.sb3` import/export.
- Drive sharing and collaboration require Google login and use only the `drive.file` scope plus Google Picker.
- Yjs/WebRTC carries live edits. A selected leader writes durable snapshots to the shared Drive file and hands leadership over on departure.
- Apps Script is optional classroom support for roster, invitations, room metadata, and Drive permission setup. It never relays live Yjs updates or stores project payloads.
- `r1-persist-server`, SQLite GC, Workspace/roster/RBAC/audit remain buildable but are frozen as a future School/self-hosted track.
- AI, centralized backup, large-room collaboration, and new school-directory functionality are not part of the first Local-First release.
- Published `ProjectEnvelopeV1` and its hash contract remain unchanged. Local projects use a separate local record rather than fake organization/user values.

## Files

- Create `docs/superpowers/specs/2026-07-19-blocksync-local-first-pivot-design.md`.
- Update `docs/CURSOR_CODEX_HANDOFF.md` with the pivot decision, freeze status, and next implementation slice.
- Update `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` with a prominent frozen/superseded notice; preserve its historical body.
- Update `docs/specification/BlockSync-AI_システム仕様書・実装計画書_v1.2.md` with a prominent status note that v1.2 describes the optional School track and is no longer the primary Community roadmap; do not rewrite the full historical specification.

## Design contents

- Product boundaries and non-goals.
- Component/data-flow diagram.
- Failure semantics: local data must remain exportable when Drive, WebRTC, signaling, or Apps Script fails.
- Privacy and OAuth scope constraints.
- Staged delivery: browser-safe core, local MVP, Drive, P2P, optional Apps Script, release gates.
- Clear separation between Community runtime dependencies and School Server packages.
- Migration treatment for existing server work and the currently pending Person + audit design.
- Acceptance criteria matching the required decisions above.

## Constraints

- Do not delete existing School Server code or documents.
- Do not modify the external Cursor plan file.
- Keep changes documentation-only for this task.
- Preserve unrelated existing content.
- Commit with a Conventional Commit message.

## Verification

- Search changed documents for contradictory statements that still identify Workspace/roster as the active primary roadmap.
- Review for placeholders (`TBD`, `TODO`) and ambiguous ownership of Drive writes.
- Report changed files, verification performed, and commit SHA.
