import Database from "better-sqlite3";
import {describe, expect, it} from "vitest";
import {
  LEGACY_DIGEST_TABLES,
  captureLegacyDataDigest,
} from "./legacy-digest.js";

const EXPECTED_TABLES = [
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
] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function createFrozenSchema(
  db: Database.Database,
  options: {omitTable?: string; omitColumn?: string} = {},
): void {
  for (const table of EXPECTED_TABLES) {
    if (table.name === options.omitTable) continue;

    const columns = table.columns.filter(
      column => `${table.name}.${column}` !== options.omitColumn,
    );
    const primaryKey = table.orderBy.filter(column => columns.includes(column));
    db.exec(
      `CREATE TABLE ${quoteIdentifier(table.name)} (` +
        [
          ...columns.map(quoteIdentifier),
          `PRIMARY KEY (${primaryKey.map(quoteIdentifier).join(", ")})`,
        ].join(", ") +
        ")",
    );
  }
}

function rowValues(
  table: (typeof EXPECTED_TABLES)[number],
  row: number,
): unknown[] {
  return table.columns.map(column =>
    table.orderBy.includes(column as never)
      ? `${row}:${column}`
      : `value:${table.name}:${column}:${row}`,
  );
}

function seedDatabase(reverse = false): Database.Database {
  const db = new Database(":memory:");
  createFrozenSchema(db);
  const rows = reverse ? [2, 1] : [1, 2];

  for (const table of EXPECTED_TABLES) {
    const columns = table.columns.map(quoteIdentifier).join(", ");
    const placeholders = table.columns.map(() => "?").join(", ");
    const insert = db.prepare(
      `INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders})`,
    );
    for (const row of rows) insert.run(...rowValues(table, row));
  }

  return db;
}

function updateFirstRow(
  db: Database.Database,
  table: (typeof EXPECTED_TABLES)[number],
  column: string,
  value: unknown,
): void {
  const where = table.orderBy
    .map(key => `${quoteIdentifier(key)} = ?`)
    .join(" AND ");
  const values = rowValues(table, 1);
  const keyValues = table.orderBy.map(
    key => values[table.columns.indexOf(key as never)],
  );
  db.prepare(
    `UPDATE ${quoteIdentifier(table.name)}
     SET ${quoteIdentifier(column)} = ?
     WHERE ${where}`,
  ).run(value, ...keyValues);
}

describe("legacy digest frozen source contract", () => {
  it("freezes all 17 tables, every column, and complete primary-key ordering", () => {
    expect(LEGACY_DIGEST_TABLES).toEqual(EXPECTED_TABLES);
  });
});

describe("captureLegacyDataDigest", () => {
  it("is deterministic across independently seeded databases and row insertion order", () => {
    const first = seedDatabase();
    const second = seedDatabase(true);

    try {
      expect(captureLegacyDataDigest(first)).toBe(
        captureLegacyDataDigest(second),
      );
      expect(captureLegacyDataDigest(first)).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      first.close();
      second.close();
    }
  });

  it("includes every frozen cell", () => {
    const baseline = seedDatabase();
    try {
      const expected = captureLegacyDataDigest(baseline);

      for (const table of EXPECTED_TABLES) {
        for (const column of table.columns) {
          const changed = seedDatabase();
          try {
            updateFirstRow(
              changed,
              table,
              column,
              `changed:${table.name}:${column}`,
            );
            expect(
              captureLegacyDataDigest(changed),
              `${table.name}.${column}`,
            ).not.toBe(expected);
          } finally {
            changed.close();
          }
        }
      }
    } finally {
      baseline.close();
    }
  });

  it("detects a secret-bearing csrf_hash change", () => {
    const db = seedDatabase();
    try {
      const digestBeforeCsrfChange = captureLegacyDataDigest(db);
      updateFirstRow(db, EXPECTED_TABLES[5], "csrf_hash", "changed-secret");
      const digestAfterCsrfChange = captureLegacyDataDigest(db);

      expect(digestBeforeCsrfChange).not.toBe(digestAfterCsrfChange);
    } finally {
      db.close();
    }
  });

  it("preserves NULL, integer, real, text, and blob distinctions", () => {
    const digestFor = (value: unknown): string => {
      const db = seedDatabase();
      try {
        updateFirstRow(db, EXPECTED_TABLES[5], "last_seen_at", value);
        return captureLegacyDataDigest(db);
      } finally {
        db.close();
      }
    };

    const digestWithNull = digestFor(null);
    const digestWithEmptyString = digestFor("");
    const digestWithIntegerZero = digestFor(0);
    const realDb = seedDatabase();
    let digestWithRealZero: string;
    try {
      realDb
        .prepare(
          `UPDATE sessions
           SET last_seen_at = CAST(0.5 AS REAL)
           WHERE id_hash = ?`,
        )
        .run("1:id_hash");
      digestWithRealZero = captureLegacyDataDigest(realDb);
    } finally {
      realDb.close();
    }
    const digestWithTextZero = digestFor("0");
    const digestWithBlob = digestFor(Buffer.from([0, 1, 254, 255]));

    expect(digestWithNull).not.toBe(digestWithEmptyString);
    expect(digestWithIntegerZero).not.toBe(digestWithTextZero);
    expect(digestWithIntegerZero).not.toBe(digestWithRealZero);
    expect(digestWithBlob).toBe(digestFor(Buffer.from([0, 1, 254, 255])));
    expect(digestWithBlob).not.toBe(digestFor(Buffer.from([0, 1, 254, 0])));
  });

  it("fails closed when a frozen table is missing", () => {
    const db = new Database(":memory:");
    createFrozenSchema(db, {omitTable: "sessions"});
    try {
      expect(() => captureLegacyDataDigest(db)).toThrow(/sessions/i);
    } finally {
      db.close();
    }
  });

  it("fails closed when a frozen column is missing", () => {
    const db = new Database(":memory:");
    createFrozenSchema(db, {omitColumn: "sessions.csrf_hash"});
    try {
      expect(() => captureLegacyDataDigest(db)).toThrow(/sessions.*csrf_hash/i);
    } finally {
      db.close();
    }
  });
});
