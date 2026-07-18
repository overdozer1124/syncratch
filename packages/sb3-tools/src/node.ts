import {spawn} from "node:child_process";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {
  DEFAULT_LIMITS,
  type LoadResult,
  type LoadSb3IsolatedOptions,
  type LoadSb3IsolatedOutcome,
  type Sb3ImportManifest,
  type Sb3SafetyLimits,
} from "./index.js";

export type {
  LoadSb3IsolatedOptions,
  LoadSb3IsolatedOutcome,
  Sb3ImportManifest,
} from "./index.js";

export function loadSb3Isolated(
  bytes: Uint8Array,
  partialLimits: Partial<Sb3SafetyLimits> = {},
  options: LoadSb3IsolatedOptions = {},
): Promise<LoadSb3IsolatedOutcome> {
  const heapMb = options.heapMb ?? 64;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const workerHoldMs = options.workerHoldMs ?? 0;
  const manifestHoldMs = options.manifestHoldMs ?? 0;
  const worker = join(
    dirname(fileURLToPath(import.meta.url)),
    "load-sb3-worker.mjs",
  );

  return new Promise(resolve => {
    let settled = false;
    let timedOut = false;
    const finish = (result: LoadSb3IsolatedOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();
        child.stdin.destroy();
      } catch {
        // The child may already have closed all streams.
      }
      resolve(result);
    };

    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${heapMb}`, "--import", "tsx", worker],
      {
        env: {
          ...process.env,
          GATE0_SB3_LIMITS: JSON.stringify({
            ...DEFAULT_LIMITS,
            ...partialLimits,
          }),
          ...(workerHoldMs > 0
            ? {GATE0_SB3_WORKER_HOLD_MS: String(workerHoldMs)}
            : {}),
          ...(manifestHoldMs > 0
            ? {GATE0_SB3_MANIFEST_HOLD_MS: String(manifestHoldMs)}
            : {}),
          ...(options.dataRootReal
            ? {GATE0_SB3_DATA_ROOT_REAL: options.dataRootReal}
            : {}),
          ...(options.holdingBudgetBytes !== undefined
            ? {
                GATE0_SB3_HOLDING_BUDGET_BYTES: String(
                  options.holdingBudgetBytes,
                ),
              }
            : {}),
          ...(options.spoolPath
            ? {GATE0_SB3_SPOOL_PATH: options.spoolPath}
            : {}),
          ...(options.holdingDir
            ? {GATE0_SB3_HOLDING_DIR: options.holdingDir}
            : {}),
          ...(options.workerTempDir
            ? {GATE0_SB3_WORKER_TEMP_DIR: options.workerTempDir}
            : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const childPid = child.pid ?? null;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // The child may have exited between timeout and kill.
      }
    }, timeoutMs);

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", data => out.push(data));
    child.stderr.on("data", data => err.push(data));
    child.on("error", error => {
      finish({
        ok: false,
        warnings: [],
        issues: [
          {
            code: "TOO_LARGE",
            message: `isolate spawn failed: ${error.message}`,
          },
        ],
        timedOut: false,
        childPid,
        childExited: true,
        exitCode: null,
        signal: null,
      });
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          warnings: [],
          issues: [
            {
              code: "TOO_LARGE",
              message: `isolate timed out after ${timeoutMs}ms`,
            },
          ],
          timedOut: true,
          childPid,
          childExited: true,
          exitCode: code,
          signal,
        });
        return;
      }
      const text = Buffer.concat(out).toString("utf8");
      try {
        const parsed = JSON.parse(text) as LoadResult & {
          manifest?: Sb3ImportManifest;
        };
        finish({
          ...parsed,
          timedOut: false,
          childPid,
          childExited: true,
          exitCode: code,
          signal,
        });
      } catch {
        finish({
          ok: false,
          warnings: [],
          issues: [
            {
              code: "TOO_LARGE",
              message: `isolate exited code=${code} signal=${signal}: ${Buffer.concat(err).toString("utf8") || text}`,
            },
          ],
          timedOut: false,
          childPid,
          childExited: true,
          exitCode: code,
          signal,
        });
      }
    });
    if (options.spoolPath) {
      child.stdin.end();
    } else {
      child.stdin.write(Buffer.from(bytes));
      child.stdin.end();
    }
  });
}
