/**
 * Isolated SB3 loader worker — run under a capped V8 heap suggestion so
 * inflate bombs cannot grow the parent process. Parent writes zip bytes to
 * stdin; we reply JSON on stdout.
 *
 * Test hook: GATE0_SB3_WORKER_HOLD_MS (only when NODE_ENV=test or
 * GATE0_TEST_HOOKS=1) sleeps before load so the parent can exercise timeout.
 */
import { loadSb3 } from "./index.ts";

function testHooksAllowed() {
  return process.env.NODE_ENV === "test" || process.env.GATE0_TEST_HOOKS === "1";
}

const holdMs = Number(process.env.GATE0_SB3_WORKER_HOLD_MS || 0);
if (Number.isFinite(holdMs) && holdMs > 0) {
  if (!testHooksAllowed()) {
    process.stderr.write(
      "GATE0_SB3_WORKER_HOLD_MS ignored outside test env\n",
    );
  } else {
    await new Promise((r) => setTimeout(r, holdMs));
  }
}

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const bytes = Buffer.concat(chunks);

const limits = process.env.GATE0_SB3_LIMITS
  ? JSON.parse(process.env.GATE0_SB3_LIMITS)
  : undefined;

try {
  const result = await loadSb3(new Uint8Array(bytes), limits);
  const { assets: _a, ...rest } = result;
  process.stdout.write(JSON.stringify(rest));
  process.exit(result.ok ? 0 : 2);
} catch (e) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      warnings: [],
      issues: [
        {
          code: "TOO_LARGE",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    }),
  );
  process.exit(1);
}
