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
- Mandatory review-fix RED cycles covered hash-gated reconnect, failed/stale local flush rejection, pre-generated create IDs, bounded stream cancellation, missing response bodies, concurrent connect deduplication, auth-token clearing, active-project switching, shared-drive query flags, octet-stream SB3 validation, and the boot gate.
- Final security RED cycles covered reserve/create API separation, durable reservation before POST, persistence failure with zero uploads, crash/reload 404 recovery using the same ID, AbortSignal propagation, stream cancellation, and late GIS/Picker/reserve callbacks after disconnect.

### GREEN

- Drive package: 22 tests passed.
- Editor unit/integration: 45 tests passed, including real fake-IndexedDB create/open/update preservation.
- Editor E2E: 7 tests passed, including no-config local operation and zero Google requests.
- SB3 tools: 56 tests passed.
- Browser local core: 14 tests passed.
- IndexedDB store: 12 tests passed.

## Google API constraints

Verified against official documentation:

- GIS token model: <https://developers.google.com/identity/oauth2/web/guides/use-token-model>
- Picker web sample: <https://developers.google.com/drive/picker/guides/sample>
- Drive files get/create/update: <https://developers.google.com/drive/api/reference/rest/v3/files>
- Drive files.generateIds: <https://developers.google.com/drive/api/reference/rest/v3/files/generateIds>
- Multipart uploads: <https://developers.google.com/workspace/drive/api/guides/manage-uploads#multipart>

Implementation constraints:

- OAuth scope is exactly `https://www.googleapis.com/auth/drive.file`.
- Google scripts load only after explicit Connect Google.
- Tokens are held only in a closure and are never written to storage, records, URLs, logs, Yjs, or Apps Script.
- Picker grants access only through user-selected/uploaded files.
- Drive uploads use `uploadType=multipart` with `multipart/related`, metadata first, and SB3 media second.
- The adapter separates `reserveFileId()` from `createFile({fileId, ...})`. The editor durably CAS-saves the reserved ID to IndexedDB before any upload POST, then creates with exactly that ID.
- If durable ID persistence fails, no create POST starts. After a crash, uncertain POST, or metadata 404, explicit Save reuses the persisted ID; it never silently reserves a replacement.
- Create and update include `supportsAllDrives=true`.
- Updates fetch `version`, `headRevisionId`, `appProperties`, and capabilities before writing and compare the caller's in-memory observation.
- Reconnect adopts remote metadata as an observation only when its state hash matches freshly flushed, committed local SB3 bytes. Missing or different remote hashes enter conflict.
- Drive export uses committed IndexedDB document/assets only after local save state is `clean`; failed/stale flushes and active-project changes stop upload.
- Metadata is fetched again after writing. Snapshot mismatch is post-write, best-effort conflict detection only. It is not atomic compare-and-swap or a strict distributed lock.
- Downloads check metadata size, require a readable response body, and stream only through `maxBytes + 1`; overflow cancels immediately. MIME is not trusted: `.sb3` extension, size, and browser-safe `loadSb3` validation are authoritative.
- A 401/authentication error disconnects GIS and clears the in-memory token. Concurrent connects share one token request.
- Concurrent explicit Drive saves share one in-flight operation, preventing duplicate create IDs/files.
- Connect/open/save operations carry a generation and AbortController. Disconnect increments the generation, aborts all in-flight Drive fetches/readers, and invalidates late GIS and Picker callbacks.
- Generation is checked after every asynchronous boundary and before IDB link persistence or status publication, preventing disconnected operations from restoring `connected`/`synced` or starting later writes.
- Drive controls remain disabled until editor boot completes.
- No background Drive autosave was added.

### Best-effort limits

- Google Drive does not provide an atomic compare-and-swap for this upload flow. A writer can race between preflight metadata and upload.
- Post-write metadata verification detects a mismatched attempted snapshot after bytes may already have been written.
- A pre-generated ID preserves file identity across uncertain create outcomes, but it cannot prove whether a failed network response reached Drive.
- AbortSignal is best-effort at the remote boundary: abort prevents subsequent local actions and asks fetch/stream to cancel, but cannot prove that Google did not receive bytes already transmitted before cancellation.
- An ID that previously represented a deleted Drive file is never replaced silently. Recreating that same ID may be rejected by Drive, in which case the editor remains unsynced/conflicted and requires explicit resolution.

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
