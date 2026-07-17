import Database from "better-sqlite3";
import {configureSqliteConnection} from "./migrations/configure.js";
import {runSchemaMigrations} from "./migrations/index.js";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("dbPath is required");
const db = new Database(dbPath);
try {
  configureSqliteConnection(db);
  runSchemaMigrations(db);
  process.stdout.write(`${JSON.stringify({ok: true})}\n`);
} finally {
  db.close();
}
