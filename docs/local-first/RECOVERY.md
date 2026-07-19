# Local-First recovery runbook

BlockSync Community has no central project backup. Each browser's IndexedDB
copy and user-created SB3/Drive files are the recovery sources.

## Always preserve data first

When Drive, signaling, WebRTC, or Apps Script fails:

1. keep the editor tab open;
2. wait for the local status to show **Saved**, or use **Retry save**;
3. download an `.sb3` before clearing site data, changing browser profiles, or
   reinstalling the browser;
4. do not delete Drive revisions or another participant's IndexedDB copy.

Never promise that an update reached another peer merely because it is saved
locally.

## Failure-specific actions

| Failure | Safe response |
| --- | --- |
| Signaling unavailable | Existing data channels may continue. New joins stop. Continue locally and export SB3. |
| WebRTC disconnected | Continue local editing. Treat peer changes as unsynchronized until reconnection and visible convergence. |
| Drive authentication/permission/quota failure | Keep the local copy, reconnect Google or reselect the file with Picker, and do not create an automatic replacement file. |
| Drive conflict or suspected split brain | Stop automatic Drive writes. Preserve every local copy and available Drive revision. Rejoin, compare/reconverge, and save only after explicit user confirmation. |
| Leader leaves | Remaining authenticated peers re-elect a logical leader. The new leader must re-observe Drive before writing. This is best-effort, not a distributed lock. |
| Apps Script unavailable or over quota | Roster, classroom invitation, and automated sharing are degraded only. Use direct invite and Google Drive sharing. |

## Browser storage warning

IndexedDB belongs to the browser profile and origin. Incognito/private mode,
site-data cleanup, storage eviction, a changed domain, or a changed Pages base
URL can make the local copy unavailable. For important projects, download SB3
and optionally save to Drive before those changes.

## Apps Script limits

Google quotas are per user and reset 24 hours after the first request. Google
documents a six-minute execution limit and different consumer/Workspace daily
limits. Treat quota errors as classroom-feature degradation:
<https://developers.google.com/apps-script/guides/services/quotas>.
