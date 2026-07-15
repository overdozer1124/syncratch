import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { StubAuthContext } from "@blocksync/auth-context";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteProjectRepository } from "@blocksync/project-store-sqlite";
import { createPersistApp } from "./server.js";

const dataDir = process.env.R1_DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });
const port = Number(process.env.PORT ?? "8787");

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

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`r1-persist-server listening on ${info.port} data=${dataDir}`);
});
