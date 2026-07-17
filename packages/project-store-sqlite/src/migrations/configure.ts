import type Database from "better-sqlite3";
import type {ConfigureSqliteOptions} from "./types.js";

export function configureSqliteConnection(
  db: Database.Database,
  options: ConfigureSqliteOptions = {},
): void {
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError("busyTimeoutMs must be a non-negative integer");
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
}
