import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { StubAuthContext } from "@blocksync/auth-context";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteProjectRepository } from "@blocksync/project-store-sqlite";
import { createPersistApp } from "@blocksync/r1-persist-server";

const dataDir = process.env.R1_DATA_DIR;
if (!dataDir) {
  console.error("R1_DATA_DIR required");
  process.exit(1);
}
mkdirSync(dataDir, { recursive: true });
const port = Number(process.env.PORT ?? "0");

const repo = openSqliteProjectRepository({
  dbPath: join(dataDir, "projects.sqlite"),
});
const service = createProjectService({
  auth: new StubAuthContext(),
  repo,
  snapshots: createFsSnapshotStore(join(dataDir, "snapshots")),
});
const app = createPersistApp({
  auth: new StubAuthContext(),
  service,
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(`READY ${info.port}\n`);
});

const shutdown = () => {
  try {
    repo.close();
  } catch {
    // ignore
  }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Keep reference so the process stays alive under tsx.
void server;
