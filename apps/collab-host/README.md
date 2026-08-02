# `@blocksync/collab-host`

Same-origin verification host for Syncratch:

- serves `apps/editor-web/dist` over HTTP
- attaches `@blocksync/collab-signaling` at `WS /signal`
- optional classroom admin API (`/api/admin/*`) + student grant/policy API
  (`/api/student/grant`, `/api/student/policy`, legacy `/api/student/policy-by-token/*`)

Intended for **Railway** (or any always-on Node host). This is not TURN and not a
central project store — Yjs / assets still travel over encrypted WebRTC data
channels between browsers.

## Local

```bash
# from repo root (after vendor GUI build once)
pnpm gate0:build-vendor-vm
pnpm gate0:build-vendor-gui-spike
VITE_COLLAB_SIGNALING_URL=same-origin pnpm --filter @blocksync/editor-web build
pnpm --filter @blocksync/collab-host start
```

Open `http://127.0.0.1:8080/`. Collaboration uses `ws://127.0.0.1:8080/signal`.

## Railway

See `docs/local-first/DEPLOYMENT.md` (Railway section) and root `railway.toml`.

Required build-time editor env:

| Variable | Value |
| --- | --- |
| `VITE_COLLAB_SIGNALING_URL` | `same-origin` |
| `BLOCKSYNC_BASE_PATH` | `/` |

Optional Drive vars (`VITE_GOOGLE_*`) can be set as **Docker build args** for
Picker / client ID. For reload-safe Drive auth, also set **runtime** secrets:

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Same as `VITE_GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (runtime only) |
| `GOOGLE_OAUTH_REDIRECT_URI` | Optional; default `https://<host>/oauth/google/callback` |

Register the Railway HTTPS origin under **Authorized JavaScript origins** and the
callback under **Authorized redirect URIs**.

Endpoints when configured:

- `GET /oauth/google/status` → `{ available: true }`
- `GET /oauth/google/start` → redirect to Google (offline access + PKCE)
- `GET /oauth/google/callback` → exchange code, set HttpOnly session cookie
- `GET /oauth/google/session` → short-lived access token (refresh as needed)
- `POST /oauth/google/logout` → revoke + clear cookie

Refresh tokens never leave the server process. Current store is in-memory (single
Railway instance); a process restart clears sessions and users reconnect once.

## Classroom admin (Phase 1 + 2)

Optional layer for allowlisted teachers. Spec:
`docs/superpowers/specs/2026-07-30-admin-student-access-design.md`.

| Runtime env | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Same browser client ID (ID token `aud`) |
| `SYNCRATCH_ADMIN_EMAILS` | CSV of allowed admin emails (required; no self-signup) |
| `ADMIN_DB_PATH` | Optional SQLite path (default `./data/admin.sqlite`) |
| `SYNCRATCH_DATA_DIR` | Optional data dir; uses `<dir>/admin.sqlite` when `ADMIN_DB_PATH` unset (Docker default `/app/data`) |
| `VITE_GOOGLE_CLIENT_ID` | Build-time; needed for `/admin` GIS login button |

To keep policies/links across redeploys on Railway, attach a **Railway Volume**
mounted at `/app/data` (do not add a Docker `VOLUME` instruction — Railway rejects it).

Surfaces (SPA via static fallback):

- `/admin` — allowlisted Google login, policy edit, link issue/revoke/reissue, expiry
- `/s/{token}` — first load exchanges token → HttpOnly grant → URL becomes `/s`
- `/s` — student editor session (grant cookie; policy via `/api/student/policy`)
- `/` — unchanged Community editor

Student grant cookie `syncratch_student_grant` (HttpOnly, short TTL) is separate
from admin `syncratch_admin_session` and Drive `syncratch_drive_session`.

HTML responses for `/s` navigations include `Referrer-Policy: no-referrer`.

## Health

`GET /healthz` → `200 ok`
