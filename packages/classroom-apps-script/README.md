# Optional Apps Script classroom adapter

This package is an optional classroom control plane. The Community editor does
not import it at runtime. Removing or disabling the deployment must not affect
solo editing, IndexedDB, direct Drive saving, existing WebRTC rooms, or SB3
export.

The adapter stores only:

- roster rows;
- room and invitation metadata;
- Drive permission operation results.

Requests are limited to 32 KiB and reject project documents, SB3 bytes, assets,
Yjs updates, and Google tokens at any nesting depth.

## Deploy

1. Create a Google Sheet owned by the teacher or school.
2. Create an Apps Script project and copy `apps-script/Code.gs` and
   `apps-script/appsscript.json` into it.
3. Add script properties:
   - `BLOCKSYNC_SHEET_ID`: the Sheet ID.
   - `BLOCKSYNC_ADMIN_EMAILS`: comma-separated teacher administrator emails.
   - `BLOCKSYNC_GOOGLE_CLIENT_ID`: the same browser client ID used to issue the
     Google ID token sent by the classroom client.
   - `BLOCKSYNC_ALLOWED_EMAIL_DOMAIN`: optional domain restriction for Drive
     sharing recipients, for example `example.edu`.
4. Deploy as a web app that executes as the deploying teacher. Public web-app
   access is safe only with the included Google ID-token audience, expiry,
   verified-email, roster, and administrator checks intact.
5. Configure the deployment `/exec` HTTPS URL as the optional classroom
   endpoint.

The script creates `Roster`, `Rooms`, `Invitations`, and `PermissionResults`
tabs when needed. Add roster rows with the columns
`classId,email,displayName,role,active`. A non-admin teacher must have an active
`teacher` row for the class.

Drive permission automation uses the deploying teacher's Drive authority and
therefore asks only that Apps Script owner for Drive scope. Browser users send
a short-lived Google ID token with the configured OAuth client audience; the
script does not use cross-origin Google cookies and never stores the token. Use
a dedicated OAuth client ID for this adapter rather than sharing its audience
with another backend.
This deployment is separate from the editor OAuth client, which remains
restricted to `drive.file`. Schools that do not accept the broader Apps Script
scope should omit this optional adapter and share the selected Drive file
directly in Google Drive.

## Browser client

`createClassroomAppsScriptClient` requires an injected `getIdentityToken`
callback and exposes:

- `listRoster(classId)`
- `getRoom(roomId)`
- `upsertRoom(room)`
- `createInvitation(invitation)`
- `setDrivePermission(permission)`

Failures are typed and do not include deployment response bodies. Applications
must treat `UNAVAILABLE` as a degraded classroom feature, not as an editor or
project-saving failure.

Token verification uses Google's `tokeninfo` endpoint and therefore consumes
Apps Script URL Fetch quota. A quota outage disables only this optional
adapter. Current limits are documented at
<https://developers.google.com/apps-script/guides/services/quotas>.
