import Database from "better-sqlite3";
import type { AuthRepository } from "@blocksync/session-service";
import type { AssetRepository } from "./asset-repository.js";
import type { ProjectRepository } from "@blocksync/project-service";
import { createSqliteAssetRepository } from "./asset-repository.js";
import { createSqliteAuthRepository } from "./auth-repository.js";
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
  return {
    projectRepo,
    authRepo,
    assetRepo,
    close() {
      db.close();
    },
  };
}
