import type Database from "better-sqlite3";
import {
  AssetNotGrantedError,
  AssetNotLiveError,
  AssetRefMismatchError,
  type CommitAssetExpectation,
  type CommitAssetGuard,
} from "@blocksync/project-service";

function assertDbMetadata(
  sha256: string,
  row: {
    gcState: string;
    md5Hex: string;
    dataFormat: string;
    byteLength: number;
  },
  expected: CommitAssetExpectation,
): void {
  if (row.md5Hex !== expected.md5Hex) {
    throw new AssetRefMismatchError(`DB_MD5:${sha256}`);
  }
  if (row.dataFormat !== expected.dataFormat) {
    throw new AssetRefMismatchError(`DB_DATA_FORMAT:${sha256}`);
  }
  if (row.byteLength !== expected.byteLength) {
    throw new AssetRefMismatchError(`DB_BYTE_LENGTH:${sha256}`);
  }
}

export function createSqliteCommitAssetGuard(
  db: Database.Database,
): CommitAssetGuard {
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
    assertLiveGrantsInCommit(organizationId, expectations) {
      for (const expected of expectations) {
        const row = getObject.get(expected.sha256) as
          | {
              gcState: string;
              md5Hex: string;
              dataFormat: string;
              byteLength: number;
            }
          | undefined;
        if (!row || row.gcState !== "live") {
          throw new AssetNotLiveError(expected.sha256);
        }
        assertDbMetadata(expected.sha256, row, expected);
        const grant = hasGrant.get(organizationId, expected.sha256) as
          | { ok: number }
          | undefined;
        if (!grant) {
          throw new AssetNotGrantedError(expected.sha256);
        }
      }
    },
  };
}
