# Task 4 report

## Scope

- Added browser-only `@blocksync/google-drive-sync` with dependency-injected GIS, Picker, and Drive REST boundaries.
- Added explicit Drive connect/open/save/disconnect controls to `apps/editor-web`.
- IndexedDB remains the source of truth. Only `driveFileId` is persisted; access tokens and Drive observations remain memory-only.

## TDD evidence

### RED

- Package tests: failed because `packages/google-drive-sync/src/index.ts` did not exist.
- Editor integration tests: failed because `drive-integration.ts` and the package entry did not exist.
- E2E: failed because `drive-status` and Drive controls did not exist.
- Follow-up RED cycles covered local-change unsynced state, official `multipart/related` upload formatting, reconnect re-observation, uncertain-create duplicate prevention, and local Drive-link CAS retry.

### GREEN

- Drive package: 15 tests passed.
- Editor unit/integration: 23 tests passed, including real fake-IndexedDB create/open/update preservation.
- Editor E2E: 7 tests passed, including no-config local operation and zero Google requests.
- SB3 tools: 56 tests passed.
- Browser local core: 14 tests passed.
- IndexedDB store: 12 tests passed.

## Google API constraints

Verified against official documentation:

- GIS token model: <https://developers.google.com/identity/oauth2/web/guides/use-token-model>
- Picker web sample: <https://developers.google.com/drive/picker/guides/sample>
- Drive files get/create/update: <https://developers.google.com/drive/api/reference/rest/v3/files>
- Multipart uploads: <https://developers.google.com/workspace/drive/api/guides/manage-uploads#multipart>

Implementation constraints:

- OAuth scope is exactly `https://www.googleapis.com/auth/drive.file`.
- Google scripts load only after explicit Connect Google.
- Tokens are held only in a closure and are never written to storage, records, URLs, logs, Yjs, or Apps Script.
- Picker grants access only through user-selected/uploaded files.
- Drive uploads use `uploadType=multipart` with `multipart/related`, metadata first, and SB3 media second.
- Updates fetch `version`, `headRevisionId`, `appProperties`, and capabilities before writing and compare the caller's in-memory observation.
- Metadata is fetched again after writing. Snapshot mismatch is post-write, best-effort conflict detection only. It is not atomic compare-and-swap or a strict distributed lock.
- Download metadata size is checked before buffering; downloaded bytes are then passed through browser-safe `loadSb3`.
- No background Drive autosave was added.

## Verification

- `pnpm --filter @blocksync/google-drive-sync test`
- `pnpm --filter @blocksync/google-drive-sync typecheck`
- `pnpm --filter @blocksync/google-drive-sync build:browser`
- `pnpm --filter @blocksync/editor-web test`
- `pnpm --filter @blocksync/editor-web typecheck`
- `pnpm --filter @blocksync/editor-web build`
- `pnpm --filter @blocksync/editor-web build:e2e`
- `pnpm --filter @blocksync/editor-web test:e2e`
- `pnpm --filter @blocksync/sb3-tools test`
- `pnpm --filter @blocksync/project-local-core test`
- `pnpm --filter @blocksync/project-store-idb test`
- `pnpm build`
- `pnpm audit --prod` (`No known vulnerabilities found`)

All commands exited successfully. SB3 VM tests emitted their existing no-renderer costume warnings.
# Task 4 Report — Documentation, Handoff, and Final Gates

**Status:** READY_FOR_CODEX_REVIEW
**Documentation commit:** `8881045` — `docs(r1): record enrollment update and end slice`
**Implementation review target:** `cd83e0445fa2178b91520b9860ebd027a1b21e29` — `feat(store): update and end enrollments with uniqueness`

## Documentation

- Marked the enrollment update/end design as implemented from the Task 3 SHA.
- Recorded the active-only update/end follow-on in the attendance uniqueness design.
- Added the Phase 3 Task 4 thin-slice note while keeping broad Task 5 unchecked.
- Updated the current state and appended the timestamped Codex handoff log.
- Did not modify `docs/ai-platform/`.

## Final gates

All commands exited 0:

- `pnpm --filter @blocksync/workspace-directory test` — 67 tests passed
- `pnpm --filter @blocksync/workspace-directory typecheck`
- `pnpm --filter @blocksync/project-store-sqlite test` — 290 tests passed; directory repository contract: 37 tests passed
- `pnpm --filter @blocksync/project-store-sqlite typecheck`
- `pnpm r1:persist:test`
- `git diff --check`

## Remaining

Class-move orchestration, overlap service rules, claim, System Owner transfer, and audit remain open. Pre-existing `.superpowers/sdd/` working-tree changes were left untouched.

## Task 4 review finding fix — 2026-07-18 20:39:48 JST

- Corrected the top progress narrative so the approved/main-merged status applies only to prior Directory thin slices.
- Replaced the stale next-steps instruction with a Codex review request for the enrollment update/end thin slice; approval, main integration, and next-slice preparation remain blocked on that review.

### Evidence

- `docs/CURSOR_CODEX_HANDOFF.md` now states `READY_FOR_CODEX_REVIEW` and pins the review target to implementation SHA `cd83e0445fa2178b91520b9860ebd027a1b21e29`, not the docs tip.
- `git diff --check -- docs/CURSOR_CODEX_HANDOFF.md .superpowers/sdd/task-4-report.md` exited 0.
- `docs/ai-platform/` was not modified.
