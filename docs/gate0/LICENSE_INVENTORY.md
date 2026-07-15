# License Inventory (Gate 0)

| Component | Path / package | License | Notes |
|---|---|---|---|
| Scratch Editor monorepo | `vendor/scratch-editor` @ `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` | AGPL-3.0-only | Upstream root `package.json` |
| scratch-vm (classic npm used for Gate 0 headless) | `scratch-vm@5.0.300` | AGPL-3.0-only | Interim runtime; see INTERNAL_API_DEPS |
| scratch-gui | vendor package | AGPL-3.0-only | Not loaded in Gate 0 tests |
| scratch-render | vendor package | AGPL-3.0-only | Not loaded headless |
| scratch-svg-renderer | vendor package | AGPL-3.0-only | Vendor source |
| @blocksync/project-schema | `packages/project-schema` | Proprietary / TBD project license | Experimental Gate 0 |
| @blocksync/google-identity | `packages/google-identity` | Proprietary / TBD | Authn only |
| @blocksync/sb3-tools | `packages/sb3-tools` | Proprietary / TBD | |
| @blocksync/collaboration-domain | `packages/collaboration-domain` | Proprietary / TBD | |
| @blocksync/scratch-adapter | `packages/scratch-adapter` | Proprietary / TBD; depends on AGPL VM | Coupling listed in INTERNAL_API_DEPS |
| jose | npm | MIT | JWT verification |
| yjs | npm | MIT | CRDT |
| jszip | npm | MIT / GPLv3 dual | SB3 zip |
| ws | npm | MIT | WebSocket |

Project-level distribution license for BlockSync packages is **not finalized** in Gate 0; Scratch AGPL obligations for combined works must be reviewed before Release 1.

Trademark / character assets: Gate 0 fixtures use **original** minimal SVG placeholders only — no Scratch cat costume redistribution.
