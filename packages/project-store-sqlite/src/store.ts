import Database from "better-sqlite3";
import type { AuthRepository } from "@blocksync/session-service";
import type { ProjectRepository } from "@blocksync/project-service";
import { createSqliteAuthRepository } from "./auth-repository.js";
import { migrate } from "./migrate.js";
import { migrateAuth } from "./migrate-auth.js";
import { createSqliteProjectRepository } from "./project-repository.js";

export interface SqliteStoreOptions {
  dbPath: string;
}

export interface SqliteStore {
  projectRepo: ProjectRepository;
  authRepo: AuthRepository;
  close(): void;
}

export function openSqliteStore(options: SqliteStoreOptions): SqliteStore {
  const db = new Database(options.dbPath);
  migrate(db);
  migrateAuth(db);
  const projectRepo = createSqliteProjectRepository(db);
  const authRepo = createSqliteAuthRepository(db);
  return {
    projectRepo,
    authRepo,
    close() {
      db.close();
    },
  };
}
