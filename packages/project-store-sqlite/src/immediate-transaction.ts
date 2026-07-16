import type Database from "better-sqlite3";

/** Run fn inside BEGIN IMMEDIATE … COMMIT (Design §4.6.2). */
export function withImmediateTransaction<T>(
  db: Database.Database,
  fn: () => T,
): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback failure after primary error.
    }
    throw err;
  }
}
