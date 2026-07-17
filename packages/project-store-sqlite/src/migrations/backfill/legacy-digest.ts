import {createHash} from "node:crypto";
import type Database from "better-sqlite3";

export interface LegacyDigestTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly orderBy: readonly string[];
}

export const LEGACY_DIGEST_TABLES = [
  {
    name: "organizations",
    columns: ["id", "name", "status", "created_at"],
    orderBy: ["id"],
  },
  {
    name: "organization_domains",
    columns: ["organization_id", "hosted_domain"],
    orderBy: ["organization_id", "hosted_domain"],
  },
  {
    name: "users",
    columns: [
      "id",
      "primary_organization_id",
      "display_name",
      "email",
      "status",
      "created_at",
      "updated_at",
    ],
    orderBy: ["id"],
  },
  {
    name: "organization_memberships",
    columns: ["organization_id", "user_id", "role"],
    orderBy: ["organization_id", "user_id"],
  },
  {
    name: "external_identities",
    columns: [
      "provider",
      "subject",
      "user_id",
      "organization_id",
      "created_at",
    ],
    orderBy: ["provider", "subject"],
  },
  {
    name: "sessions",
    columns: [
      "id_hash",
      "user_id",
      "organization_id",
      "csrf_hash",
      "created_at",
      "expires_at",
      "revoked_at",
      "last_seen_at",
    ],
    orderBy: ["id_hash"],
  },
  {
    name: "projects",
    columns: [
      "id",
      "organization_id",
      "owner_user_id",
      "title",
      "head_revision",
      "created_at",
      "updated_at",
    ],
    orderBy: ["id"],
  },
  {
    name: "project_members",
    columns: ["project_id", "user_id", "role"],
    orderBy: ["project_id", "user_id"],
  },
  {
    name: "project_revisions",
    columns: [
      "project_id",
      "revision",
      "envelope_json",
      "content_hash",
      "request_hash",
      "actor_user_id",
      "created_at",
      "client_transaction_id",
    ],
    orderBy: ["project_id", "revision"],
  },
  {
    name: "project_snapshots",
    columns: [
      "id",
      "project_id",
      "based_on_revision",
      "reason",
      "content_hash",
      "storage_key",
      "created_by",
      "created_at",
    ],
    orderBy: ["project_id", "id"],
  },
  {
    name: "asset_objects",
    columns: [
      "sha256",
      "byte_length",
      "md5_hex",
      "data_format",
      "gc_state",
      "quarantine_started_at",
      "created_at",
    ],
    orderBy: ["sha256"],
  },
  {
    name: "organization_asset_grants",
    columns: ["organization_id", "sha256", "granted_at"],
    orderBy: ["organization_id", "sha256"],
  },
  {
    name: "asset_import_leases",
    columns: [
      "lease_id",
      "organization_id",
      "sha256",
      "import_session_id",
      "created_at",
      "expires_at",
    ],
    orderBy: ["lease_id"],
  },
  {
    name: "global_disk_reservations",
    columns: [
      "reservation_id",
      "import_session_id",
      "reserved_bytes",
      "materialized_bytes",
      "expires_at",
      "created_at",
    ],
    orderBy: ["reservation_id"],
  },
  {
    name: "organization_asset_quota_reservations",
    columns: [
      "reservation_id",
      "organization_id",
      "import_session_id",
      "reserved_bytes",
      "expires_at",
      "created_at",
    ],
    orderBy: ["reservation_id"],
  },
  {
    name: "organization_asset_quota_reservation_shas",
    columns: ["reservation_id", "sha256", "byte_length"],
    orderBy: ["reservation_id", "sha256"],
  },
  {
    name: "asset_gc_lock",
    columns: ["id", "owner", "generation", "acquired_at", "expires_at"],
    orderBy: ["id"],
  },
] as const satisfies readonly LegacyDigestTable[];

type SQLiteType = "null" | "integer" | "real" | "text" | "blob";
type EncodedValue = readonly [SQLiteType, null | string];

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function assertFrozenSchema(
  db: Database.Database,
  table: LegacyDigestTable,
): void {
  const exists = db
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table' AND name = ?`,
    )
    .get(table.name);
  if (exists === undefined) {
    throw new Error(`Legacy digest table is missing: ${table.name}`);
  }

  const tableColumns = db.pragma(
    `table_info(${quoteIdentifier(table.name)})`,
  ) as Array<{name: string}>;
  const present = new Set(tableColumns.map(column => column.name));
  for (const column of table.columns) {
    if (!present.has(column)) {
      throw new Error(
        `Legacy digest column is missing: ${table.name}.${column}`,
      );
    }
  }
}

function encodeReal(value: number): string {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeDoubleBE(value);
  return bytes.toString("hex");
}

function encodeValue(type: unknown, value: unknown): EncodedValue {
  switch (type) {
    case "null":
      if (value !== null) break;
      return ["null", null];
    case "integer":
      if (typeof value !== "bigint") break;
      return ["integer", value.toString(10)];
    case "real":
      if (typeof value !== "number") break;
      return ["real", encodeReal(value)];
    case "text":
      if (typeof value !== "string") break;
      return ["text", value];
    case "blob":
      if (!Buffer.isBuffer(value)) break;
      return ["blob", value.toString("hex")];
  }

  throw new Error(
    `Unexpected SQLite value from legacy digest query: ${String(type)}`,
  );
}

function captureTable(
  db: Database.Database,
  table: LegacyDigestTable,
): {
  name: string;
  columns: readonly string[];
  rows: EncodedValue[][];
} {
  assertFrozenSchema(db, table);

  const selection = table.columns
    .flatMap(column => [
      quoteIdentifier(column),
      `typeof(${quoteIdentifier(column)})`,
    ])
    .join(", ");
  const ordering = table.orderBy.map(quoteIdentifier).join(", ");
  const rawRows = db
    .prepare(
      `SELECT ${selection}
       FROM ${quoteIdentifier(table.name)}
       ORDER BY ${ordering}`,
    )
    .safeIntegers()
    .raw()
    .all() as unknown[][];

  return {
    name: table.name,
    columns: table.columns,
    rows: rawRows.map(row => {
      const encoded: EncodedValue[] = [];
      for (let index = 0; index < row.length; index += 2) {
        encoded.push(encodeValue(row[index + 1], row[index]));
      }
      return encoded;
    }),
  };
}

export function captureLegacyDataDigest(db: Database.Database): string {
  const payload = {
    format: "blocksync.r1-legacy-digest/v1",
    tables: LEGACY_DIGEST_TABLES.map(table => captureTable(db, table)),
  };

  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}
