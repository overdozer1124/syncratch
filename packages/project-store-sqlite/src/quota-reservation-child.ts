import Database from "better-sqlite3";
import { createSqliteAssetRepository } from "./asset-repository.js";
import { migrate } from "./migrate.js";
import { migrateAssets } from "./migrate-assets.js";
import { migrateAuth } from "./migrate-auth.js";

const [dbPath, reservationId, organizationId, importSessionId, sha256, byteLength] =
  process.argv.slice(2);
if (
  !dbPath ||
  !reservationId ||
  !organizationId ||
  !importSessionId ||
  !sha256 ||
  !byteLength
) {
  throw new Error(
    "usage: quota-reservation-child <dbPath> <reservationId> <organizationId> <importSessionId> <sha256> <byteLength>",
  );
}

const db = new Database(dbPath);
migrate(db);
migrateAuth(db);
migrateAssets(db);
const repo = createSqliteAssetRepository(db);

try {
  repo.createQuotaReservation({
    reservationId,
    organizationId,
    importSessionId,
    shas: [{ sha256, byteLength: Number(byteLength) }],
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
