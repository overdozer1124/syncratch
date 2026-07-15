# R1 Auth / Session / Organization Runbook

Experimental Google cookie-session auth on the R1 persistence server. Design: `docs/superpowers/specs/2026-07-15-r1-auth-org-design.md`.

## Modes

| `R1_AUTH_MODE` | Behavior |
|---|---|
| `stub` | Header spoofing (`x-user-id`); **forbidden** when `NODE_ENV=production` |
| `google` | GIS ID token → opaque session cookie + CSRF cookie |

## Environment

| Variable | Notes |
|---|---|
| `R1_AUTH_MODE` | `stub` \| `google` |
| `R1_GOOGLE_CLIENT_ID` | Required in google mode (token `aud`) |
| `R1_ALLOWED_HOSTED_DOMAINS` | Comma-separated Google `hd` allow-list |
| `R1_ALLOWED_ORIGINS` | Required non-empty in google mode |
| `R1_GOOGLE_AUTHORIZED_PARTIES` | Optional comma Client IDs; empty ⇒ `azp` not enforced |
| `R1_COOKIE_SECURE` | Must be `true` in production google mode |
| `R1_ALLOW_INSECURE_COOKIES` | Only with `NODE_ENV=test` + google + Secure=false |
| `R1_DATA_DIR` | Shared `projects.sqlite` (project + auth tables) |

## Cookies

| Name | HttpOnly | Notes |
|---|---|---|
| `blocksync_session` | yes | Raw session id; DB stores `sha256` only |
| `blocksync_csrf` | **no** | Double-submit with `X-CSRF-Token`; DB stores hash only |

Both: `SameSite=Lax`, `Path=/`, `Secure` per boot config. Clear attributes must match set attributes.

## Route matrix (google mode)

| Route | Session | CSRF | Origin |
|---|---|---|---|
| `POST /v1/auth/google` | no | no | required allow-list |
| `GET /v1/auth/me` | yes | no | n/a |
| `POST /v1/auth/logout` | yes | yes (cookie+header) | required |
| Project mutations | yes | yes (cookie+header) | required |

CSRF: missing cookie, missing header, mismatch, or hash mismatch → **403**.

## Entropy

Production session/CSRF ids: `randomBytes(32).toString("base64url")` only.

## Tests

```bash
pnpm r1:auth:test
```

Real GIS evidence (optional): `apps/r1-auth-smoke/README.md` + `docs/r1/AUTH_EVIDENCE.md`.
