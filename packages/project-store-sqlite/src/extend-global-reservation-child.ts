import Database from "better-sqlite3";
import { createSqliteAssetRepository } from "./asset-repository.js";
import { migrate } from "./migrate.js";
import { migrateAssets } from "./migrate-assets.js";
import { migrateAuth } from "./migrate-auth.js";

const [dbPath, importSessionId, additionalBytes, fileBytes] =
  process.argv.slice(2);
if (!dbPath || !importSessionId || !additionalBytes || !fileBytes) {
  throw new Error(
    "usage: extend-global-reservation-child <dbPath> <importSessionId> <additionalBytes> <fileBytes>",
  );
}

const db = new Database(dbPath);
migrate(db);
migrateAuth(db);
migrateAssets(db);
const repo = createSqliteAssetRepository(db);

try {
  repo.extendGlobalDiskReservation({
    importSessionId,
    additionalBytes: Number(additionalBytes),
    fileBytes: Number(fileBytes),
  });
  process.stdout.write(JSON.stringify({ ok: true }));
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.name : String(err),
    }),
  );
} finally {
  db.close();
}
