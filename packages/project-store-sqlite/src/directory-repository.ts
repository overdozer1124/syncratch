import type Database from "better-sqlite3";
import type {WorkspaceDirectoryRepository} from "@blocksync/workspace-directory";

export function createSqliteWorkspaceDirectoryRepository(
  db: Database.Database,
): WorkspaceDirectoryRepository {
  return {
    withTransaction(fn) {
      return db.transaction(() => fn(null as unknown as never))();
    },
  };
}
