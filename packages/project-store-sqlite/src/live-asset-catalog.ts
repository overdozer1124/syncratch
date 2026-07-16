import type Database from "better-sqlite3";
import type { LiveAssetCatalog } from "@blocksync/project-service";
import { createSqliteCommitAssetGuard } from "./commit-asset-guard.js";

export function createSqliteLiveAssetCatalog(
  db: Database.Database,
): LiveAssetCatalog {
  const guard = createSqliteCommitAssetGuard(db);
  const getObject = db.prepare(`
    SELECT
      gc_state AS gcState,
      md5_hex AS md5Hex,
      data_format AS dataFormat,
      byte_length AS byteLength
    FROM asset_objects
    WHERE sha256 = ?
  `);
  const hasGrant = db.prepare(`
    SELECT 1 AS ok
    FROM organization_asset_grants
    WHERE organization_id = ? AND sha256 = ?
  `);

  return {
    getAsset(sha256) {
      const row = getObject.get(sha256) as
        | {
            gcState: string;
            md5Hex: string;
            dataFormat: string;
            byteLength: number;
          }
        | undefined;
      if (!row) return null;
      return {
        sha256,
        byteLength: row.byteLength,
        md5Hex: row.md5Hex,
        dataFormat: row.dataFormat,
        gcState: row.gcState as "live" | "quarantining" | "quarantined",
      };
    },
    hasOrgGrant(organizationId, sha256) {
      const grant = hasGrant.get(organizationId, sha256) as
        | { ok: number }
        | undefined;
      return !!grant;
    },
    assertLiveGrantsInCommit: guard.assertLiveGrantsInCommit.bind(guard),
  };
}
