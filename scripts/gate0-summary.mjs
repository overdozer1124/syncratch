#!/usr/bin/env node
/**
 * Prints a reminder to update docs/gate0/GO_NO_GO.md after local runs.
 * Does not invent pass/fail — human/CI evidence drives the verdict file.
 */
console.log(
  "[gate0:summary] Update docs/gate0/GO_NO_GO.md and docs/gate0/evidence/ after test runs.",
);
console.log(
  "  Required commands: pnpm gate0:check-pin && pnpm gate0:check-licenses && pnpm gate0:test && pnpm gate0:collab",
);
