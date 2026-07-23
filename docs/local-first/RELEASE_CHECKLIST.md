# Local-First release checklist

Record the commit, date, browser versions, static origin, signaling deployment,
and Google Cloud project used for every release candidate.

Latest automated mainline run is recorded in
`docs/local-first/FINAL_ACCEPTANCE_REPORT.md`
(tip `d179efff59827007cd84664a52234f188e88cb1b`, 2026-07-22 JST).

Manual Google / remaining human checks:
`docs/local-first/STAGE5_MANUAL_GATES.md`.

## Automated gates

Re-run on tip `d179eff` (2026-07-22 23:56–23:59 JST, cloud agent):

- [x] `pnpm --filter @blocksync/editor-web test`（206/206）
- [x] `pnpm --filter @blocksync/editor-web typecheck`
- [x] `pnpm --filter @blocksync/editor-web build`
- [x] Run `pnpm --filter @blocksync/editor-web verify:static` with the deployment
      `BLOCKSYNC_BASE_PATH`（`/`）
- [x] Production `dist` contains `index.html` and does not contain
      `collab-harness.html`.
- [x] `pnpm --filter @blocksync/editor-web test:e2e -- e2e/editor.spec.ts e2e/collab.spec.ts`（18/18）
- [x] `pnpm --filter @blocksync/google-drive-sync test`（25/25）
- [x] `pnpm --filter @blocksync/classroom-apps-script test`（14/14）
- [x] `pnpm --filter @blocksync/collaboration-domain test`（43/43）
- [x] `pnpm --filter @blocksync/collab-webrtc test`（35/35）
- [x] `pnpm --filter @blocksync/collab-signaling test`（18/18）
- [x] `pnpm --filter @blocksync/collab-invite test`（13/13）
- [x] `pnpm --filter @blocksync/collab-host test`（4/4）
- [x] Frozen School/self-hosted packages still pass the repository build and
      relevant existing tests（`pnpm r1:persist:test` / `pnpm r1:auth:test`）
- [x] `pnpm gate0:test` / `pnpm gate0:collab`（2/2）
- [x] Online probe: `https://syncratch-production.up.railway.app/healthz` → `ok`（HTTP 200）

The browser suite covers local autosave/reload, SB3 round-trip and recovery,
save failure, offline/static-only reload, two real Chromium peers, same-sprite
different-stack survival, logical leader paths, signaling outage, local
recovery, and export.

## Manual Google gates

These require a real Google test project and are intentionally not run with CI
credentials. Follow `STAGE5_MANUAL_GATES.md` §A.

Drive deploy evidence (2026-07-23): Railway production bundle includes
`VITE_GOOGLE_*` and `drive.file`; user confirmed Drive integration works on
`https://syncratch-production.up.railway.app/`.

- [x] Solo edit starts without Google login.
- [x] OAuth consent shows `drive.file`, not broad Drive scopes.
- [x] Picker opens only an explicitly selected SB3.
- [x] Two different Google test users can access the same shared Drive file.
- [ ] Only the room creator (invite host) attempts the normal Drive snapshot
      while collaborating（ゲストは Drive 上書き役にならない。手順は
      `STAGE5_MANUAL_GATES.md` A5 かんたん版）。
- [ ] Revoking one user's permission stops that user's Drive write without
      stopping local save or SB3 export.
- [ ] A concurrent Drive change causes safe conflict stop; it does not silently
      overwrite or create a replacement file.

Automated support (not a substitute for the consent-screen / real-Drive checks):

- `packages/google-drive-sync` requests exactly `drive.file` and keeps the
  access token in memory only.
- `apps/editor-web` conflict handling stops automatic Drive saves after conflict
  and allows only an explicit creator save to clear it.

## Failure and privacy gates

### Covered by automated evidence on tip `d179eff`

- [x] Disable signaling before joining / during invite: local editing and SB3
      export remain  
      （e2e `signaling outage leaves local editing and SB3 export available`、
      unit `evaluateCollabReadiness`）
- [x] Remove the leader: remaining peer leadership / Drive-writer authorization
      stays creator-bound; reobserve is diagnostics-only for guest writers  
      （`collab-session.test.ts` leadership / Drive authorization）
- [x] Signaling stores no project payload or Yjs update  
      （`collab-signaling` hub statelessness: relayed payloads not retained）
- [x] Apps Script rejects project/SB3/asset/Yjs payload keys and requests over
      32 KiB  
      （`classroom-apps-script` contract tests）

### Still require human confirmation（`STAGE5_MANUAL_GATES.md` §B）

- [ ] Disconnect a peer: no UI claims its unseen changes are synchronized.
- [x] Disable Apps Script (or leave unset): solo, direct invite, existing P2P,
      Drive, and export remain usable.（Apps Script 未導入のまま Railway で Drive 連携成功）
- [ ] Inspect IndexedDB, SB3, Y.Doc, logs, signaling frames, and classroom
      Sheets: no Google access/refresh/Picker token is present.

## Scope statement

Do not advertise AI, central backup, audit, a new school directory, large-room
relay, TURN availability, or strict distributed Drive locking in this release.
The existing School server remains an optional buildable track and is not a
Community runtime dependency.
