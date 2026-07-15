# R1 Auth — Real GIS Evidence Template

Fill this after a successful live Google Identity Services smoke. Without a completed evidence section, the auth slice remains **Technical Go — real GIS conditional**.

## Environment

| Field | Value |
|---|---|
| Date (UTC) | |
| Operator | |
| Google Cloud project / OAuth Client ID | |
| Workspace `hd` used | |
| Server commit SHA | |
| `R1_ALLOWED_HOSTED_DOMAINS` | |
| `R1_ALLOWED_ORIGINS` | |
| `R1_GOOGLE_AUTHORIZED_PARTIES` (or empty) | |
| Cookie Secure | true |

## Procedure

1. Boot `r1-persist-server` with `R1_AUTH_MODE=google` and production-safe cookie Secure.
2. Load a GIS button page on an allow-listed Origin (see `apps/r1-auth-smoke`).
3. Complete Google sign-in for a Workspace user whose `hd` is allow-listed.
4. Confirm `Set-Cookie` for `blocksync_session` (HttpOnly) and `blocksync_csrf` (not HttpOnly).
5. Call a mutating API with both CSRF cookie and `X-CSRF-Token` + Origin.
6. Restart the server process; retry the mutating API with the same browser cookies (no CSRF reconstruction from `/me`).
7. Sign out; confirm both cookies cleared with matching Secure/SameSite/Path.

## Evidence checklist

- [ ] Screenshot or HAR: successful `/v1/auth/google` with allow-listed Origin
- [ ] Cookie attributes recorded (HttpOnly / Secure / SameSite / Path)
- [ ] Mutating call after process restart succeeds
- [ ] Disallowed Origin login → 403
- [ ] No Google ID token / raw session / raw CSRF observed in SQLite or server logs

## Attachments

List filenames of HARs / screenshots stored outside the repo (do not commit secrets).
