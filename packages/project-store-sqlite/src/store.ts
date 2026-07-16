import Database from "better-sqlite3";
import type { AuthRepository } from "@blocksync/session-service";
import type { CommitAssetGuard, LiveAssetCatalog } from "@blocksync/project-service";
import type { AssetRepository } from "./asset-repository.js";
import type { ProjectRepository } from "@blocksync/project-service";
import { createSqliteAssetRepository } from "./asset-repository.js";
import { createSqliteAuthRepository } from "./auth-repository.js";
import { createSqliteCommitAssetGuard } from "./commit-asset-guard.js";
import { createSqliteLiveAssetCatalog } from "./live-asset-catalog.js";
import { migrate } from "./migrate.js";
import { migrateAssets } from "./migrate-assets.js";
import { migrateAuth } from "./migrate-auth.js";
import { createSqliteProjectRepository } from "./project-repository.js";

export interface SqliteStoreOptions {
  dbPath: string;
}

export interface SqliteStore {
  projectRepo: ProjectRepository;
  authRepo: AuthRepository;
  assetRepo: AssetRepository;
  commitAssets: CommitAssetGuard;
  liveCatalog: LiveAssetCatalog;
  close(): void;
}

export function openSqliteStore(options: SqliteStoreOptions): SqliteStore {
  const db = new Database(options.dbPath);
  migrate(db);
  migrateAuth(db);
  migrateAssets(db);
  const projectRepo = createSqliteProjectRepository(db);
  const authRepo = createSqliteAuthRepository(db);
  const assetRepo = createSqliteAssetRepository(db);
  const commitAssets = createSqliteCommitAssetGuard(db);
  const liveCatalog = createSqliteLiveAssetCatalog(db);
  return {
    projectRepo,
    authRepo,
    assetRepo,
    commitAssets,
    liveCatalog,
    close() {
      db.close();
    },
  };
}
