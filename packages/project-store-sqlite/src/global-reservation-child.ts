import Database from "better-sqlite3";
import { createSqliteAssetRepository } from "./asset-repository.js";
import { migrate } from "./migrate.js";
import { migrateAssets } from "./migrate-assets.js";
import { migrateAuth } from "./migrate-auth.js";

const [dbPath, reservationId, importSessionId, reservedBytes, fileBytes] =
  process.argv.slice(2);
if (!dbPath || !reservationId || !importSessionId || !reservedBytes || !fileBytes) {
  throw new Error(
    "usage: global-reservation-child <dbPath> <reservationId> <importSessionId> <reservedBytes> <fileBytes>",
  );
}

const db = new Database(dbPath);
migrate(db);
migrateAuth(db);
migrateAssets(db);
const repo = createSqliteAssetRepository(db);

try {
  repo.createGlobalDiskReservation({
    reservationId,
    importSessionId,
    reservedBytes: Number(reservedBytes),
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
