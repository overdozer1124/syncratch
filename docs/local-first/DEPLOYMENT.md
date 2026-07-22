# Local-First deployment

The Syncratch editor is a static SPA. Solo editing needs no application server,
database, or object storage. A deployment consists of:

1. static files from `apps/editor-web/dist`;
2. an optional Google browser OAuth configuration for Drive;
3. a small WebSocket signaling service for new WebRTC connections;
4. an optional Apps Script classroom adapter.

## Static site

Build from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm gate0:build-vendor-vm
pnpm gate0:build-vendor-gui-spike
pnpm --filter @blocksync/editor-web test
pnpm --filter @blocksync/editor-web typecheck
pnpm --filter @blocksync/editor-web build
```

Publish `apps/editor-web/dist` to any HTTPS static host. Set
`BLOCKSYNC_BASE_PATH=/repository-name/` at build time for a GitHub project
Pages URL, or `/` for a custom domain. The
`.github/workflows/local-first-pages.yml` workflow builds and deploys the
artifact without a runtime server.

GitHub documents a 1 GB published-site limit, a soft 100 GB/month bandwidth
limit, and a 10-minute deployment timeout:
<https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>.
These are hosting limits, not Syncratch capacity guarantees.

## Google Drive configuration

Create a Google Cloud web OAuth client and enable Google Drive API and Google
Picker API. Configure these public build variables:

| Variable | Value |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Browser OAuth client ID |
| `VITE_GOOGLE_API_KEY` | API key restricted to the deployed HTTPS origin |
| `VITE_GOOGLE_APP_ID` | Google Cloud project number used by Picker |

Register the exact deployment origin under **Authorized JavaScript origins**.
Origins contain scheme and host only, not a path, query, or fragment. Production
origins must use HTTPS; localhost is the development exception. Google setup
reference:
<https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid>.

The editor requests only `https://www.googleapis.com/auth/drive.file`. Do not
replace it with broad Drive or read-only Drive scopes. Tokens stay in memory and
must not be written to IndexedDB, SB3, Yjs, logs, or Apps Script properties.

## Signaling

Set `VITE_COLLAB_SIGNALING_URL` to an explicit `wss://` endpoint running
`@blocksync/collab-signaling`. There is no public fallback. The service carries
only offer/answer/ICE messages under a hashed topic; Yjs updates and project
snapshots travel over encrypted WebRTC data channels.

For same-origin hosts (Railway `collab-host`), set
`VITE_COLLAB_SIGNALING_URL=same-origin`. The editor resolves that sentinel at
runtime to `wss://<page-host>/signal` (or `ws:` on `http:`).

The reference service enforces connection, topic, peer, message-size, and idle
limits. It is not TURN. Restrictive school networks can therefore prevent peer
connection; the editor must continue local save and SB3 export in that case.

For a free-tier Cloudflare port, use a SQLite-backed Durable Object with the
WebSocket Hibernation API and preserve the protocol documented in
`packages/collab-signaling/README.md`. As of 2026-07-19, Cloudflare documents
100,000 Durable Object requests/day and 13,000 GB-s/day on Workers Free. Limits
can change and excess free operations fail rather than becoming an availability
guarantee:
<https://developers.cloudflare.com/durable-objects/platform/pricing/>.

## Railway (static + signaling, no TURN)

Use this for online verification when GitHub Pages alone is not enough because
collaboration needs a `wss://` signaling endpoint. The repo ships:

- `apps/collab-host` — HTTP static files + WebSocket `/signal`
- `Dockerfile` + `railway.toml` — production image build

### Deploy steps

1. Create a Railway project from this GitHub repository.
2. Point the service at a branch that contains `Dockerfile` + `railway.toml`
   (until merged: `cursor/railway-collab-host-f431`). Deploying `main` without
   those files makes Railpack fail with **No start command detected**.
3. Prefer enabling **GitHub submodules**. If the archive still omits
   `vendor/scratch-editor`, the Dockerfile clones the pinned upstream commit
   via `scripts/ensure-vendor-scratch-editor.sh` during build.
4. In the service **Settings → Build**:
   - Builder = **Dockerfile** (not Railpack / Railpack automatic)
   - Dockerfile path = `Dockerfile`
   - Root directory = `/` (repository root)
5. Redeploy and confirm the build log says **Using Detected Dockerfile** (or
   equivalent). If you still see `Railpack` + `No start command detected`, the
   UI builder override is still Railpack — change it and redeploy.
6. Optional Drive verification: set Docker build args / env
   `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID`, and
   register the Railway HTTPS origin under Google **Authorized JavaScript origins**.
7. Open the generated `https://*.up.railway.app/` URL.
8. Smoke-check: editor loads, `GET /healthz` returns `ok`, create/join room works
   between two browsers (or two profiles) on ordinary networks.

Build bakes `VITE_COLLAB_SIGNALING_URL=same-origin` and `BLOCKSYNC_BASE_PATH=/`.
Runtime listens on `PORT` (Railway injects this) and serves
`STATIC_ROOT` (default `apps/editor-web/dist`).

### Current verification deployment

| Item | Value |
| --- | --- |
| Public editor | `https://syncratch-production.up.railway.app/` |
| Health | `https://syncratch-production.up.railway.app/healthz` |
| Signaling | `wss://syncratch-production.up.railway.app/signal` |
| Railway project | `radiant-cooperation` / service `syncratch` |
| Deploy branch (until PR merge) | `cursor/railway-collab-host-f431` |

Daily coding stays local. Use the Railway URL for online collab checks only.
After PR merge into `main`, switch the Railway service branch to `main`.

This path intentionally omits TURN. Peers behind restrictive NAT/firewalls may
still fail to establish a WebRTC data channel; local edit and SB3 export must
remain available.

## Optional classroom adapter

Deployment instructions and the separate OAuth trade-off are in
`packages/classroom-apps-script/README.md`. Do not make its endpoint a
prerequisite for editor startup, Drive access, collaboration, or export.
