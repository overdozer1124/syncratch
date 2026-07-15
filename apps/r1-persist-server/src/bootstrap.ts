import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { StubAuthContext } from "@blocksync/auth-context";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteStore } from "@blocksync/project-store-sqlite";
import { createPersistApp } from "./server.js";

export function bootstrapPersistRuntime(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const snapDir = join(dataDir, "snapshots");
  const store = openSqliteStore({
    dbPath: join(dataDir, "projects.sqlite"),
  });
  const repo = store.projectRepo;
  const snapshots = createFsSnapshotStore(snapDir);
  const removed = snapshots.gcOrphans(repo.listAllSnapshotStorageKeys());
  if (removed > 0) {
    console.log(`snapshot orphan GC removed ${removed} file(s)`);
  }
  const service = createProjectService({
    auth: new StubAuthContext(),
    repo,
    snapshots,
  });
  const app = createPersistApp({
    auth: new StubAuthContext(),
    service,
  });
  return {
    app,
    repo,
    authRepo: store.authRepo,
    close: () => store.close(),
    snapshots,
    service,
  };
}
