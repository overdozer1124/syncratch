# r1-auth-smoke (optional real GIS)

Minimal operator notes for live Google Identity Services validation of the R1 auth slice.

## Prerequisites

- OAuth Web Client ID with authorized JavaScript origins matching `R1_ALLOWED_ORIGINS`
- Workspace user whose `hd` is listed in `R1_ALLOWED_HOSTED_DOMAINS`
- Server:

```bash
export NODE_ENV=production
export R1_AUTH_MODE=google
export R1_COOKIE_SECURE=true
export R1_GOOGLE_CLIENT_ID=...
export R1_ALLOWED_ORIGINS=https://your-origin.example
export R1_ALLOWED_HOSTED_DOMAINS=your-domain.com
export R1_DATA_DIR=./data-auth-smoke
pnpm --filter @blocksync/r1-persist-server start
```

## Flow

1. Obtain a GIS ID token in the browser (`google.accounts.id`).
2. `POST /v1/auth/google` with `Origin` + `Content-Type: application/json` + `{ "idToken": "..." }`.
3. Use returned cookies for subsequent API calls; mutations need `X-CSRF-Token` equal to `blocksync_csrf`.

CI does **not** run live GIS. Fixture coverage is `pnpm r1:auth:test`.

Record results in `docs/r1/AUTH_EVIDENCE.md`.
