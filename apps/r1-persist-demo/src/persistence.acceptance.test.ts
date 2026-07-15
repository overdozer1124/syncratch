import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createAutosaveController } from "@blocksync/project-autosave";
import { richFixtureDocument } from "@blocksync/project-envelope";

const childEntry = fileURLToPath(new URL("./server-child.ts", import.meta.url));
const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");

async function startServer(
  dataDir: string,
): Promise<{ proc: ChildProcess; port: number; kill: () => Promise<void> }> {
  const proc = spawn(process.execPath, [tsxBin, childEntry], {
    env: {
      ...process.env,
      R1_DATA_DIR: dataDir,
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (!proc.stdout || !proc.stderr) {
    throw new Error("child process stdio not available");
  }
  const stdout = proc.stdout;
  const stderr = proc.stderr;

  const port = await new Promise<number>((resolve, reject) => {
    const rl = createInterface({ input: stdout });
    const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
    rl.on("line", (line) => {
      const m = /^READY (\d+)$/.exec(line.trim());
      if (m) {
        clearTimeout(timer);
        rl.close();
        resolve(Number(m[1]));
      }
    });
    stderr.on("data", (buf: Buffer) => {
      process.stderr.write(buf);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early: ${code}`));
    });
  });

  const kill = async () => {
    if (proc.killed || proc.exitCode !== null) return;
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 2000);
      proc.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  };

  return { proc, port, kill };
}

async function api(
  port: number,
  path: string,
  init?: RequestInit & { userId?: string },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-user-id", init?.userId ?? "user-a");
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers });
}

describe("R1 persistence acceptance", () => {
  const children: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const k of children) await k();
  });

  it("create → autosave → child restart → same revision/contentHash", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "r1-accept-"));
    const first = await startServer(dataDir);
    children.push(first.kill);

    const createRes = await api(first.port, "/v1/projects", {
      method: "POST",
      body: JSON.stringify({ title: "Accept" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      projectId: string;
      revision: number;
    };

    let baseRevision = created.revision;
    const fixture = richFixtureDocument();
    const autosave = createAutosaveController({
      debounceMs: 10,
      retryDelaysMs: [50],
      getBaseRevision: () => baseRevision,
      setBaseRevision: (r) => {
        baseRevision = r;
      },
      save: async (args) => {
        const res = await api(first.port, `/v1/projects/${created.projectId}/document`, {
          method: "PUT",
          body: JSON.stringify(args),
        });
        if (!res.ok) {
          const body = (await res.json()) as { code: string };
          const err = new Error(body.code) as Error & { code: string };
          err.code = body.code;
          throw err;
        }
        const envelope = (await res.json()) as { revision: number };
        return { revision: envelope.revision };
      },
    });

    autosave.notifyLocalEdit(fixture);
    await autosave.flush();
    expect(autosave.getState()).toBe("clean");
    autosave.dispose();

    const ackRes = await api(first.port, `/v1/projects/${created.projectId}`);
    const ack = (await ackRes.json()) as {
      revision: number;
      contentHash: string;
    };
    expect(ack.revision).toBe(1);

    await first.kill();

    const second = await startServer(dataDir);
    children.push(second.kill);
    const after = await api(second.port, `/v1/projects/${created.projectId}`);
    expect(after.status).toBe(200);
    const restored = (await after.json()) as {
      revision: number;
      contentHash: string;
    };
    expect(restored.revision).toBe(ack.revision);
    expect(restored.contentHash).toBe(ack.contentHash);
    await second.kill();
  }, 60000);
});
