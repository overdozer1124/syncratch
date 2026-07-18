import Database from "better-sqlite3";
import {DirectoryError} from "@blocksync/workspace-directory";
import {createSqliteWorkspaceDirectoryRepository} from "./directory-repository.js";
import {configureSqliteConnection} from "./migrations/configure.js";

const [dbPath, personId] = process.argv.slice(2);
if (!dbPath || !personId) {
  throw new Error("usage: directory-cas-race-child <dbPath> <personId>");
}

const db = new Database(dbPath);
configureSqliteConnection(db);
const repo = createSqliteWorkspaceDirectoryRepository(db);

try {
  repo.withTransaction(tx =>
    tx.createPerson({
      workspaceId: "ws-cas",
      expectedRevision: 0,
      person: {
        id: personId,
        displayName: personId,
        status: "active",
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
      } as never,
    }),
  );
  process.stdout.write(JSON.stringify({ok: true}));
} catch (error) {
  const code =
    error instanceof DirectoryError
      ? error.code
      : error instanceof Error
        ? error.name
        : "UNKNOWN";
  process.stdout.write(JSON.stringify({ok: false, code}));
} finally {
  db.close();
}
