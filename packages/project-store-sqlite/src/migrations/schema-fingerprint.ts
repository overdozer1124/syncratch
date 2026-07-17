import type Database from "better-sqlite3";
import baselineFingerprints from "./r1-baseline-fingerprints.json" with {
  type: "json",
};

export interface SchemaFingerprint {
  tables: Array<{
    name: string;
    sql: string;
    columns: Array<{
      cid: number;
      name: string;
      type: string;
      notNull: number;
      defaultValue: string | null;
      primaryKeyPosition: number;
    }>;
    foreignKeys: Array<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      onUpdate: string;
      onDelete: string;
      match: string;
    }>;
    indexes: Array<{
      name: string;
      unique: number;
      origin: string;
      partial: number;
      columns: string[];
    }>;
  }>;
}

export type LedgerlessSchemaClassification =
  | {kind: "empty"}
  | {kind: "current"}
  | {kind: "pre_generation"}
  | {kind: "unknown"; difference: string};

interface R1BaselineFingerprints {
  format: "blocksync.r1-schema-fingerprints/v1";
  current: SchemaFingerprint;
  preGeneration: SchemaFingerprint;
}

const acceptedBaselines = baselineFingerprints as R1BaselineFingerprints;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Normalize SQL for fingerprint comparison while preserving quoted
 * string/identifier contents exactly (including internal whitespace).
 */
export function normalizeSql(sql: string | null): string {
  if (sql == null) return "";
  const input = sql.trim();
  let out = "";
  let i = 0;

  const isWhitespace = (ch: string): boolean =>
    ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";

  while (i < input.length) {
    const ch = input[i]!;

    if (ch === "'") {
      let j = i + 1;
      while (j < input.length) {
        if (input[j] === "'") {
          if (input[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += input.slice(i, j);
      i = j;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < input.length) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += input.slice(i, j);
      i = j;
      continue;
    }

    if (ch === "`") {
      let j = i + 1;
      while (j < input.length && input[j] !== "`") j += 1;
      if (j < input.length) j += 1;
      out += input.slice(i, j);
      i = j;
      continue;
    }

    if (ch === "[") {
      let j = i + 1;
      while (j < input.length && input[j] !== "]") j += 1;
      if (j < input.length) j += 1;
      out += input.slice(i, j);
      i = j;
      continue;
    }

    if (isWhitespace(ch)) {
      while (i < input.length && isWhitespace(input[i]!)) i += 1;
      const prev = out.length > 0 ? out[out.length - 1]! : "";
      const next = i < input.length ? input[i]! : "";
      if (
        out.length === 0 ||
        prev === "(" ||
        prev === "," ||
        next === ")" ||
        next === "," ||
        next === ""
      ) {
        continue;
      }
      out += " ";
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function compareValues(
  expected: unknown,
  received: unknown,
  path: string,
): string | null {
  if (Object.is(expected, received)) return null;

  if (Array.isArray(expected) || Array.isArray(received)) {
    if (!Array.isArray(expected) || !Array.isArray(received)) {
      return `${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(received)}`;
    }
    if (expected.length !== received.length) {
      return `${path}.length: expected ${expected.length}, received ${received.length}`;
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = compareValues(
        expected[index],
        received[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return null;
  }

  if (
    expected !== null &&
    received !== null &&
    typeof expected === "object" &&
    typeof received === "object"
  ) {
    const expectedKeys = Object.keys(expected as Record<string, unknown>).sort();
    const receivedKeys = Object.keys(received as Record<string, unknown>).sort();
    if (expectedKeys.length !== receivedKeys.length) {
      return `${path}.keys.length: expected ${expectedKeys.length}, received ${receivedKeys.length}`;
    }
    for (let index = 0; index < expectedKeys.length; index += 1) {
      const expectedKey = expectedKeys[index]!;
      const receivedKey = receivedKeys[index]!;
      if (expectedKey !== receivedKey) {
        return `${path}.keys[${index}]: expected ${JSON.stringify(expectedKey)}, received ${JSON.stringify(receivedKey)}`;
      }
      const childPath = path.length === 0 ? expectedKey : `${path}.${expectedKey}`;
      const difference = compareValues(
        (expected as Record<string, unknown>)[expectedKey],
        (received as Record<string, unknown>)[expectedKey],
        childPath,
      );
      if (difference) return difference;
    }
    return null;
  }

  return `${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(received)}`;
}

export function fingerprintDifference(
  expected: SchemaFingerprint,
  received: SchemaFingerprint,
): string | null {
  return compareValues(expected, received, "");
}

export function captureSchemaFingerprint(
  db: Database.Database,
): SchemaFingerprint {
  const tables = db
    .prepare(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name <> 'schema_migrations'
       ORDER BY name`,
    )
    .all() as Array<{name: string; sql: string | null}>;

  return {
    tables: tables.map(table => {
      const tableIdentifier = quoteIdentifier(table.name);
      const columns = (
        db.pragma(`table_info(${tableIdentifier})`) as Array<{
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>
      )
        .map(column => ({
          cid: column.cid,
          name: column.name,
          type: column.type,
          notNull: column.notnull,
          defaultValue: column.dflt_value,
          primaryKeyPosition: column.pk,
        }))
        .sort((left, right) => left.cid - right.cid);

      const foreignKeys = (
        db.pragma(`foreign_key_list(${tableIdentifier})`) as Array<{
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string;
          on_update: string;
          on_delete: string;
          match: string;
        }>
      )
        .map(foreignKey => ({
          id: foreignKey.id,
          seq: foreignKey.seq,
          table: foreignKey.table,
          from: foreignKey.from,
          to: foreignKey.to,
          onUpdate: foreignKey.on_update,
          onDelete: foreignKey.on_delete,
          match: foreignKey.match,
        }))
        .sort((left, right) =>
          left.id !== right.id ? left.id - right.id : left.seq - right.seq,
        );

      const indexes = (
        db.pragma(`index_list(${tableIdentifier})`) as Array<{
          name: string;
          unique: number;
          origin: string;
          partial: number;
        }>
      )
        .filter(index => index.origin === "c")
        .map(index => {
          const indexColumns = (
            db.pragma(`index_info(${quoteIdentifier(index.name)})`) as Array<{
              seqno: number;
              name: string | null;
            }>
          )
            .sort((left, right) => left.seqno - right.seqno)
            .map(column => column.name ?? "");

          return {
            name: index.name,
            unique: index.unique,
            origin: index.origin,
            partial: index.partial,
            columns: indexColumns,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));

      return {
        name: table.name,
        sql: normalizeSql(table.sql),
        columns,
        foreignKeys,
        indexes,
      };
    }),
  };
}

export function classifyLedgerlessDatabase(
  db: Database.Database,
): LedgerlessSchemaClassification {
  const fingerprint = captureSchemaFingerprint(db);
  if (fingerprint.tables.length === 0) {
    return {kind: "empty"};
  }

  if (fingerprintDifference(acceptedBaselines.current, fingerprint) === null) {
    return {kind: "current"};
  }

  if (
    fingerprintDifference(acceptedBaselines.preGeneration, fingerprint) === null
  ) {
    return {kind: "pre_generation"};
  }

  const difference =
    fingerprintDifference(acceptedBaselines.current, fingerprint) ??
    "schema differs";
  return {kind: "unknown", difference: difference.replace(/^\./, "")};
}
