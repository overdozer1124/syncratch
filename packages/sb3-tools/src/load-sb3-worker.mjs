/**
 * Isolated SB3 loader worker — run under a capped V8 heap so inflate bombs
 * cannot grow the parent process. Parent writes zip bytes to stdin; we reply JSON.
 */
import { loadSb3 } from "./index.ts";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const bytes = Buffer.concat(chunks);

const limits = process.env.GATE0_SB3_LIMITS
  ? JSON.parse(process.env.GATE0_SB3_LIMITS)
  : undefined;

try {
  const result = await loadSb3(new Uint8Array(bytes), limits);
  // Strip Map (not JSON-serializable)
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
