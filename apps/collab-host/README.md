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

Optional Drive vars (`VITE_GOOGLE_*`) can be set in Railway for Drive checks.
Register the Railway HTTPS origin in Google OAuth **Authorized JavaScript origins**.

## Health

`GET /healthz` → `200 ok`
