import type Database from "better-sqlite3";

const PHASE2_TABLES = [
  "admin_accounts",
  "classroom_policies",
  "student_links",
  "student_grants",
] as const;

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master
       WHERE type = 'table' AND name = ?`,
    )
    .get(name) as {ok: number} | undefined;
  return row !== undefined;
}

function tableHasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const rows = db.pragma(`table_info(${table})`) as Array<{name: string}>;
  return rows.some(row => row.name === column);
}

function listUserTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as Array<{name: string}>;
  return rows.map(row => row.name);
}

export type AdminLedgerlessClassification =
  | {kind: "empty"}
  | {kind: "phase2_current"}
  | {kind: "phase1_legacy"}
  | {kind: "unknown"; difference: string};

export function classifyAdminLedgerlessDatabase(
  db: Database.Database,
): AdminLedgerlessClassification {
  const tables = new Set(listUserTables(db));
  if (tables.size === 0) {
    return {kind: "empty"};
  }

  if (tableExists(db, "schema_migrations")) {
    return {
      kind: "unknown",
      difference: "schema_migrations already exists without ledger bootstrap",
    };
  }

  const hasCore = PHASE2_TABLES.every(table => tables.has(table));
  const hasPolicies = tables.has("classroom_policies");
  const hasLinks = tables.has("student_links");
  const hasAccounts = tables.has("admin_accounts");

  if (hasCore && tableHasColumn(db, "classroom_policies", "editor_allow_extensions")) {
    return {kind: "phase2_current"};
  }

  if (
    hasAccounts &&
    hasPolicies &&
    hasLinks &&
    !tables.has("student_grants") &&
    !tableHasColumn(db, "classroom_policies", "editor_allow_extensions")
  ) {
    return {kind: "phase1_legacy"};
  }

  const expected = [...PHASE2_TABLES].sort().join(",");
  const actual = [...tables].sort().join(",");
  return {
    kind: "unknown",
    difference: `expected phase2 tables ${expected}, received ${actual}`,
  };
}

export function tableHasColumnAdmin(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  return tableHasColumn(db, table, column);
}
