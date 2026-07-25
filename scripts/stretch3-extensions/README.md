# Stretch3 → Syncratch extension bundler

Converts Stretch3 builtin-injected Scratch extensions into Xcratch-style ESM
modules for `apps/editor-web/public/extensions/`.

```bash
pnpm install --ignore-workspace   # inside this directory, once
pnpm extensions:bundle-stretch3   # from repo root
pnpm extensions:collect-icons     # gallery card images → public/extensions/icons
```

Sources are shallow-cloned into `.cache/stretch3-extensions/` (gitignored).
Commit the generated `.mjs` files, icons, and `manifest.json` / `NOTICE.md`.
