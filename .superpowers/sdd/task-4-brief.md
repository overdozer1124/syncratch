# Task 4: Google Drive shared persistence

## Goal

Add optional Google sign-in, Picker-selected Drive files, and best-effort conflict-aware shared `.sb3` persistence while keeping IndexedDB as the source of truth and local editing fully functional when Google is unavailable.

## Browser package

Create `@blocksync/google-drive-sync` with browser-only, dependency-injected boundaries:

- Google Identity Services token client using exactly `https://www.googleapis.com/auth/drive.file`.
- Google Picker integration that exposes only explicitly selected/created files.
- Drive REST adapter using injected `fetch` and in-memory access tokens.
- No refresh/access token may be written to IndexedDB, LocalProjectRecord, `.sb3`, URL, logs, Yjs, or Apps Script.
- Dynamically load Google scripts only after the user chooses Drive; local boot must not contact Google.

Define typed errors for configuration, authentication/expiry, permission, quota/rate limit, network, invalid response/file, and conflict.

## Snapshot behavior

- The Drive file payload is a validated `.sb3`.
- Store app metadata in Drive `appProperties`: snapshot ID, leadership epoch, and state/document hash.
- Fetch file metadata before write (`version`, `headRevisionId`, `appProperties`, capabilities). Refuse before writing when the observed snapshot/version differs from the caller's known observation.
- Upload metadata plus media, then fetch metadata again. If the resulting snapshot metadata is not the attempted snapshot, report a conflict and stop automatic Drive saves.
- Document and test that this is post-write/best-effort detection, not atomic CAS and not a strict distributed lock.
- On conflict, permission loss, token expiry, quota, or network failure: retain local IndexedDB data, mark Drive unsynced/conflict, and keep `.sb3` download available. Never silently create or overwrite another file.
- Validate downloaded byte size before buffering and pass bytes through browser-safe `loadSb3` before replacing/creating a local project.

## Editor integration

- Add Drive controls/status to `apps/editor-web`: Connect Google, Open from Drive, Save/sync to Drive, Disconnect.
- Solo local editing remains login-free. Drive controls clearly show “not configured” when build-time public client configuration is absent.
- Opening a Picker-selected file imports it as a new local project only after metadata, size, download, and SB3 validation succeed; set its `driveFileId`.
- First Drive save without `driveFileId` creates an app-authorized `.sb3` file; later saves update only that selected file.
- Keep Drive observation/sync state outside `LocalProjectRecord` except the allowed `driveFileId`; credentials and volatile version metadata stay memory-only.
- Explicit Drive save is sufficient for this task. Do not add background cloud autosave before P2P leadership exists.
- All recoverable Drive errors must be visible without blocking local Save/New/Open/Download.

## Tests

Use TDD. Add mocked unit/integration tests for:

- exact OAuth scope and token non-persistence;
- lazy Google script loading;
- Picker cancellation and selected file ID;
- create, read, and update request shapes;
- pre-write observation conflict and post-write mismatch;
- auth/403/404/429/5xx/network error mapping;
- oversized/invalid `.sb3` download rejection before local replacement;
- editor local functionality with no Google config and during Drive failures;
- successful Drive create/open/update preserving local IndexedDB records.

Run package tests/typecheck/browser bundle, editor unit/typecheck/build/E2E, SB3/local store tests, workspace build, and production dependency audit.

## Constraints

- Do not use broad `drive`, `drive.readonly`, Gmail, Classroom, or server-side OAuth scopes.
- Do not add a backend, client secret, refresh token, cookie session, Apps Script, WebRTC, or School package dependency.
- Do not claim atomic Drive compare-and-swap.
- Preserve all Task 3 local/offline paths and production diagnostic restrictions.
- Commit with Conventional Commits and write `.superpowers/sdd/task-4-report.md`.
