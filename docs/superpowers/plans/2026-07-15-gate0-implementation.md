# Gate 0 Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox syntax.

**Goal:** Build a minimal monorepo that runs independent Gate 0 viability checks (schema, SB3 round-trip, VM observe/step/parity, Yjs WebSocket collab, Google ID token verification) and records Go/No-Go evidence.

**Architecture:** pnpm workspace with experimental packages; Scratch pinned as git submodule outside the workspace; collaboration validates via `project-schema` before accepting structure; authn isolated in `google-identity`.

**Tech Stack:** TypeScript, pnpm, Vitest, Yjs + ws, jose (JWT), Node matching vendor `.nvmrc`, Scratch Editor submodule `v14.1.0` candidate SHA `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` (reconfirm after build).

## Global Constraints

- No R1 product UI, teacher, or AI features
- Never dirty or patch `vendor/scratch-editor`; stop and request fork if patch required
- `project-schema` must not import VM/Yjs/React
- Collab pass requires WebSocket between two processes (not BroadcastChannel-only)
- Test JWKS injection only when `NODE_ENV=test` or `GATE0_TEST_HOOKS=1`
- All package APIs `@experimental`
- SB3 fixtures: original minimal works only; document provenance
- Do not commit secrets or real ID tokens

---

### Task 1: Root workspace + pin scripts

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `scripts/check-submodule-pin.mjs`, `scripts/check-licenses.mjs`

**Produces:** `pnpm gate0:check-pin`, workspace install without vendor

- [ ] Create root `package.json` with scripts `gate0:check-pin`, `gate0:check-licenses`, `gate0:test`, `gate0:collab`
- [ ] `pnpm-workspace.yaml` packages: `packages/*`, `apps/*` only
- [ ] Pin checker reads `docs/gate0/SCRATCH_PIN.md` expected SHA and compares to `git -C vendor/scratch-editor rev-parse HEAD`; fails if dirty
- [ ] Commit scaffolding

---

### Task 2: Submodule pin + SCRATCH_PIN docs

**Files:**
- Create: `.gitmodules`, `docs/gate0/SCRATCH_PIN.md`, `docs/gate0/LICENSE_INVENTORY.md`, `docs/adr/ADR-0001-scratch-submodule-upstream-pin.md`, `docs/adr/ADR-0002-gate0-monorepo-layout.md`

**Produces:** Fixed SHA submodule; documentation of Node/license/init

- [ ] `git submodule add https://github.com/scratchfoundation/scratch-editor.git vendor/scratch-editor`
- [ ] Checkout SHA for tag `v14.1.0` (`7c172e469eb3c21c1e6326ea6cccea60bc14e3a8`); verify `.nvmrc`; copy to root `.nvmrc`
- [ ] Attempt vendor install/build (or document blocker); record selection rationale (not “最新”)
- [ ] Write LICENSE_INVENTORY from package licenses (AGPL-3.0-only root)
- [ ] Write ADR-0001 / ADR-0002
- [ ] Commit pin + docs only (no vendor dirty)

---

### Task 3: `project-schema`

**Files:**
- Create: `packages/project-schema/**`

**Produces:** `validateProject(doc): ValidationResult`; Vitest covering §16 invariants

- [ ] Types: `ProjectDocument`, `Target`, `Block`, etc.
- [ ] Checks: unique block IDs, parent/next mutual consistency, no cycles, top-level no parent, single input occupant, shadow rules (minimal), var/list/broadcast refs, opcode field presence (allowlist optional), no refs to deleted, extensions allowlist optional
- [ ] Tests: valid doc; cycle; double connection; missing var; duplicate id
- [ ] Commit

---

### Task 4: `google-identity`

**Files:**
- Create: `packages/google-identity/**`

**Produces:** `verifyGoogleIdToken(token, options)`; fixture tests with mock JWKS

- [ ] Use `jose` for JWT verify; JWKS via injectable `createRemoteJWKSet` or custom getter
- [ ] Validate iss (`accounts.google.com` / `https://accounts.google.com`), aud, azp when required, exp/iat, sub, email_verified, hd exact match when school mode
- [ ] Hooks: only if `allowTestHooks === true` AND (`NODE_ENV===test` OR `GATE0_TEST_HOOKS=1`)
- [ ] Generate ephemeral RSA key in tests; cases listed in design
- [ ] Commit

---

### Task 5: `sb3-tools` + corpus

**Files:**
- Create: `packages/sb3-tools/**`, `fixtures/sb3/**`, `docs/gate0/SB3_CORPUS.md`

**Produces:** load/validate/round-trip helpers; corpus tests

- [ ] Minimal ZIP safety: size, entry count, path traversal, compression ratio bound
- [ ] Parse `project.json`; run `project-schema.validate`
- [ ] Create minimal valid SB3 fixture programmatically (empty costume stub as allowed data URI / tiny PNG)
- [ ] Round-trip semantic equality on targets/blocks/vars (not byte-identical)
- [ ] Malicious zip path `../` rejected
- [ ] Commit

---

### Task 6: `scratch-adapter` observe/step/parity

**Files:**
- Create: `packages/scratch-adapter/**`, `docs/gate0/INTERNAL_API_DEPS.md`

**Produces:** `createRuntime()`, `observe()`, `stepVisual()`, `runToEnd()`, parity tests

- [ ] Resolve VM from `vendor/scratch-editor/packages/scratch-vm` after vendor build, OR matching published `@scratch/scratch-vm` version locked to pin with INTERNAL_API note — prefer vendor path when present
- [ ] Opcode allowlist from design
- [ ] Visual step = one command/hat/control boundary
- [ ] Parity: move + set variable project; compare final x/y/vars
- [ ] If vendor patch required → STOP per design
- [ ] Commit

---

### Task 7: `collaboration-domain` + collab apps

**Files:**
- Create: `packages/collaboration-domain/**`, `apps/gate0-collab-server/**`, `apps/gate0-collab-demo/**` (or Node clients)

**Produces:** `pnpm gate0:collab` — two Node WS clients sync sprite ops via server; schema validates

- [ ] Y.Doc with per-sprite maps; apply op → materialize → `validateProject` → accept/reject
- [ ] Minimal `y-websocket`-style relay or `ws` + Yjs sync protocol
- [ ] Integration test: 1000 ops across two sprites / two processes
- [ ] Commit

---

### Task 8: auth-smoke + CI + GO_NO_GO

**Files:**
- Create: `apps/gate0-auth-smoke/**`, `.github/workflows/gate0.yml`, `docs/gate0/GO_NO_GO.md`, `scripts/gate0-summary.mjs`

**Produces:** Optional smoke; CI pin/dirty/tests; verdict doc

- [ ] auth-smoke skips unless `GOOGLE_CLIENT_ID` set
- [ ] CI: checkout recursive, check-pin, frozen lockfile, package tests, collab
- [ ] GO_NO_GO with 条件付き合格 for real Google / legal tracks
- [ ] Commit

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| SHA pin + docs | 2 |
| License inventory | 2 |
| SB3 corpus | 5 |
| VM observe/step/parity | 6 |
| project-schema | 3 |
| Yjs WS two-process | 7 |
| Google hybrid authn | 4 + 8 |
| CI pin/dirty | 8 |
| Go/No-Go | 8 |
| Stop on patch need | 6 |

## Self-review

- No TBD placeholders for required behaviors
- Package names match design (`google-identity`, not authz)
- Collab explicitly WebSocket two-process
