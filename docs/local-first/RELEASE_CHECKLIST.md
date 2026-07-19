# Local-First release checklist

Record the commit, date, browser versions, static origin, signaling deployment,
and Google Cloud project used for every release candidate.

## Automated gates

- [ ] `pnpm --filter @blocksync/editor-web test`
- [ ] `pnpm --filter @blocksync/editor-web typecheck`
- [ ] `pnpm --filter @blocksync/editor-web build`
- [ ] Run `pnpm --filter @blocksync/editor-web verify:static` with the deployment
      `BLOCKSYNC_BASE_PATH`.
- [ ] Production `dist` contains `index.html` and does not contain
      `collab-harness.html`.
- [ ] `pnpm --filter @blocksync/editor-web test:e2e -- e2e/editor.spec.ts e2e/collab.spec.ts`
- [ ] `pnpm --filter @blocksync/google-drive-sync test`
- [ ] `pnpm --filter @blocksync/classroom-apps-script test`
- [ ] `pnpm --filter @blocksync/collaboration-domain test`
- [ ] `pnpm --filter @blocksync/collab-webrtc test`
- [ ] `pnpm --filter @blocksync/collab-signaling test`
- [ ] Frozen School/self-hosted packages still pass the repository build and
      relevant existing tests.

The browser suite covers local autosave/reload, SB3 round-trip and recovery,
save failure, offline/static-only reload, two real Chromium peers, logical
leader departure/handoff, signaling outage, local recovery, and export.

## Manual Google gates

These require a real Google test project and are intentionally not run with CI
credentials:

- [ ] Solo edit starts without Google login.
- [ ] OAuth consent shows `drive.file`, not broad Drive scopes.
- [ ] Picker opens only an explicitly selected SB3.
- [ ] Two different Google test users can access the same shared Drive file.
- [ ] Only the visible logical leader attempts the normal Drive snapshot.
- [ ] Revoking one user's permission stops that user's Drive write without
      stopping local save or SB3 export.
- [ ] A concurrent Drive change causes safe conflict stop; it does not silently
      overwrite or create a replacement file.

## Failure and privacy gates

- [ ] Disable signaling before joining: local editing and SB3 export remain.
- [ ] Disconnect a peer: no UI claims its unseen changes are synchronized.
- [ ] Remove the leader: a remaining peer becomes leader and re-observes Drive
      before writing.
- [ ] Disable Apps Script: solo, direct invite, existing P2P, Drive, and export
      remain usable.
- [ ] Inspect IndexedDB, SB3, Y.Doc, logs, signaling frames, and classroom
      Sheets: no Google access/refresh/Picker token is present.
- [ ] Signaling stores no project payload or Yjs update.
- [ ] Apps Script rejects project/SB3/asset/Yjs payload keys and requests over
      32 KiB.

## Scope statement

Do not advertise AI, central backup, audit, a new school directory, large-room
relay, TURN availability, or strict distributed Drive locking in this release.
The existing School server remains an optional buildable track and is not a
Community runtime dependency.
