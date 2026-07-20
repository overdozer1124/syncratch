# Task 3: Static local editor MVP

## Goal

Deliver a static `apps/editor-web` Scratch editor that requires no server or login and survives reload through an atomic IndexedDB project store, with browser `.sb3` import/export.

## Required packages

### `@blocksync/project-store-idb`

- Browser-only IndexedDB adapter for `LocalProjectRecord`.
- Version 1 database with a `projects` object store keyed by `localProjectId`.
- API to open/close the store and get, list, create/replace with expected revision, and delete projects.
- Perform revision comparison and record write in the same readwrite transaction.
- Throw typed errors for not found, revision conflict, invalid record, transaction failure, and quota failure.
- Return structured-cloned records; never expose mutable references held by the adapter.
- Database upgrades and aborted transactions must not leave partial records.
- Unit-test with `fake-indexeddb`, including create/read, atomic replacement, stale CAS, reload, delete, malformed record, transaction abort, and typed-array preservation.

### `apps/editor-web`

- Vite static SPA using the pinned standalone Scratch GUI build already produced by `scripts/build-vendor-scratch-gui-spike.mjs`.
- Build/dev preparation copies the generated GUI bundle and existing safe fixtures into app-local generated/public assets without committing the generated GUI bundle.
- Toolbar: project title, New, Open `.sb3`, Download `.sb3`, explicit Save, local save status, and recoverable error/export action.
- The editor starts without Google login, VPS, HTTP API, SQLite, or School packages.
- On first visit, create a local project from the existing browser fixture. On subsequent visits, restore the most recently opened local project from IndexedDB.
- Attach ScratchStorage backed by the record's in-memory asset map, load `ProjectDocument` into the GUI VM, and convert `vm.toJSON()` back with `@blocksync/sb3-tools/browser`.
- Listen to Scratch VM `PROJECT_CHANGED`, mark dirty immediately, then use `@blocksync/project-autosave` or an equivalent generation-safe debounce to persist.
- Persist document and assets atomically with monotonically increasing revision. Handle stale-tab conflicts without overwriting the newer record.
- `.sb3` input uses browser-safe `loadSb3`; only replace the current project after a successful validated import.
- `.sb3` download uses browser-safe `exportSb3`; it remains available when automatic IndexedDB save fails.
- Do not use `ProjectEnvelopeV1` or fake organization/user IDs.

## E2E acceptance

Add Playwright coverage that uses the actual standalone Scratch GUI:

1. Fresh load mounts the GUI and reports local save ready.
2. Mutate/create a VM block, wait for autosave, reload, and verify the block remains.
3. Export the current project to `.sb3`, import it as a new local project, and verify production equivalence or the expected block/document.
4. Simulate an IndexedDB write failure and verify the UI reports failure while `.sb3` export still succeeds.
5. Run with network blocked after initial static load and prove editing/save/reload remains local.

Expose a small test-only-neutral browser diagnostic surface similar to `window.__blocksyncTask0`; it must expose real application actions, not bypass persistence.

## Tests and TDD

- Add failing store tests and failing app/E2E acceptance tests before implementation, and record RED evidence.
- Run project-store-idb tests/typecheck, editor-web unit/build/E2E, existing r1-scratch-host tests, and relevant SB3/local-core tests.
- Run workspace build after focused tests.

## Constraints

- Do not add Drive, Google auth, WebRTC, signaling, Apps Script, AI, or School Server runtime imports.
- Do not commit built vendor GUI artifacts.
- Preserve existing Task 0 spike and R1 server behavior.
- Keep user-facing strings minimal; this is an MVP shell.
- Use Conventional Commits and write `.superpowers/sdd/task-3-report.md`.
