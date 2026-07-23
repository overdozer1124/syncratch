# `@blocksync/collab-host`

Same-origin verification host for Syncratch:

- serves `apps/editor-web/dist` over HTTP
- attaches `@blocksync/collab-signaling` at `WS /signal`

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

## Health

`GET /healthz` → `200 ok`
