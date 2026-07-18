import Database from "better-sqlite3";
import type { AuthRepository } from "@blocksync/session-service";
import type { CommitAssetGuard, LiveAssetCatalog } from "@blocksync/project-service";
import type { WorkspaceDirectoryRepository } from "@blocksync/workspace-directory";
import type { AssetRepository } from "./asset-repository.js";
import type { ProjectRepository } from "@blocksync/project-service";
import { createSqliteAssetRepository } from "./asset-repository.js";
import { createSqliteAuthRepository } from "./auth-repository.js";
import { createSqliteCommitAssetGuard } from "./commit-asset-guard.js";
import { createSqliteWorkspaceDirectoryRepository } from "./directory-repository.js";
import { createSqliteLiveAssetCatalog } from "./live-asset-catalog.js";
import {configureSqliteConnection} from "./migrations/configure.js";
import {runSchemaMigrations} from "./migrations/index.js";
import { migrate } from "./migrate.js";
import { migrateAssets } from "./migrate-assets.js";
import { migrateAuth } from "./migrate-auth.js";
import { createSqliteProjectRepository } from "./project-repository.js";

export interface SqliteStoreOptions {
  dbPath: string;
}

interface SqliteStoreBase {
  projectRepo: ProjectRepository;
  authRepo: AuthRepository;
  assetRepo: AssetRepository;
  commitAssets: CommitAssetGuard;
  liveCatalog: LiveAssetCatalog;
  close(): void;
}

export interface SqliteStore extends SqliteStoreBase {
  directoryRepo: WorkspaceDirectoryRepository;
}

interface LegacySqliteStore extends SqliteStoreBase {}

function openInitializedSqliteStore(
  options: SqliteStoreOptions,
  initialize: (db: Database.Database) => void,
  includeDirectoryRepo: true,
): SqliteStore;
function openInitializedSqliteStore(
  options: SqliteStoreOptions,
  initialize: (db: Database.Database) => void,
  includeDirectoryRepo: false,
): LegacySqliteStore;
function openInitializedSqliteStore(
  options: SqliteStoreOptions,
  initialize: (db: Database.Database) => void,
  includeDirectoryRepo: boolean,
): SqliteStore | LegacySqliteStore {
  const db = new Database(options.dbPath);
  try {
    initialize(db);
    const projectRepo = createSqliteProjectRepository(db);
    const authRepo = createSqliteAuthRepository(db);
    const assetRepo = createSqliteAssetRepository(db);
    const commitAssets = createSqliteCommitAssetGuard(db);
    const liveCatalog = createSqliteLiveAssetCatalog(db);
    const store: SqliteStoreBase = {
      projectRepo,
      authRepo,
      assetRepo,
      commitAssets,
      liveCatalog,
      close() {
        db.close();
      },
    };
    return includeDirectoryRepo
      ? {
          ...store,
          directoryRepo: createSqliteWorkspaceDirectoryRepository(db),
        }
      : store;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openSqliteStore(options: SqliteStoreOptions): SqliteStore {
  return openInitializedSqliteStore(options, db => {
    configureSqliteConnection(db);
    runSchemaMigrations(db);
  }, true);
}

export function openLegacyR1StoreForFixture(
  options: SqliteStoreOptions,
): LegacySqliteStore {
  return openInitializedSqliteStore(options, db => {
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
  }, false);
}
