import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";
import {
  r1IdentityCoreChecksumSource,
  r1IdentityCoreMigration,
} from "./0002-r1-identity-core.js";

const dbs: Database.Database[] = [];

describe("0002 r1-identity-core", () => {
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it("has immutable version/name/checksum", () => {
    expect(r1IdentityCoreMigration.version).toBe(2);
    expect(r1IdentityCoreMigration.name).toBe("r1-identity-core");
    expect(r1IdentityCoreMigration.checksumSource).toBe(
      r1IdentityCoreChecksumSource,
    );
    expect(r1IdentityCoreMigration.checksum).toBe(
      computeMigrationChecksum(r1IdentityCoreChecksumSource),
    );
  });

  it("creates identity tables and enforces identity constraints", () => {
    const db = new Database(":memory:");
    dbs.push(db);
    configureSqliteConnection(db);
    r1IdentityCoreMigration.apply(db);

    for (const name of [
      "workspaces",
      "user_accounts",
      "people",
      "person_account_links",
      "workspace_memberships",
      "workspace_directory_revisions",
    ]) {
      expect(
        db
          .prepare(
            `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(name),
      ).toBeTruthy();
    }

    db.exec(`
      INSERT INTO people(id, display_name, status, created_at, updated_at)
      VALUES ('p1','Ada','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      INSERT INTO user_accounts(id, status, created_at, updated_at)
      VALUES ('a1','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      INSERT INTO user_accounts(id, status, created_at, updated_at)
      VALUES ('a2','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      INSERT INTO person_account_links(id, person_id, account_id, status, linked_at, unlinked_at)
      VALUES ('l1','p1','a1','active','2026-07-17T00:00:00.000Z',NULL);
      INSERT INTO workspaces(id, kind, name, created_at, updated_at)
      VALUES ('w1','school','School','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      INSERT INTO workspace_memberships(
        id, workspace_id, account_id, role, status, started_at, ended_at
      )
      VALUES (
        'm1','w1','a1','owner','active','2026-07-17T00:00:00.000Z',NULL
      );
    `);

    expect(() =>
      db.exec(`
        INSERT INTO person_account_links(id, person_id, account_id, status, linked_at, unlinked_at)
        VALUES ('l2','p1','a2','active','2026-07-17T00:00:00.000Z',NULL);
      `),
    ).toThrow(/UNIQUE/);

    db.exec(`
      INSERT INTO people(id, display_name, status, created_at, updated_at)
      VALUES ('p2','Grace','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    `);
    expect(() =>
      db.exec(`
        INSERT INTO person_account_links(id, person_id, account_id, status, linked_at, unlinked_at)
        VALUES ('l3','p2','a1','active','2026-07-17T00:00:00.000Z',NULL);
      `),
    ).toThrow(/UNIQUE/);

    expect(() =>
      db.exec(`
        INSERT INTO workspace_memberships(
          id, workspace_id, account_id, role, status, started_at, ended_at
        )
        VALUES (
          'm2','w1','a1','member','active','2026-07-17T00:00:00.000Z',NULL
        );
      `),
    ).toThrow(/UNIQUE/);

    expect(() =>
      db.exec(`
        INSERT INTO workspace_memberships(
          id, workspace_id, account_id, role, status, started_at, ended_at
        )
        VALUES (
          'm3','w1','a2','member','active',
          '2026-07-17T00:00:00.000Z','2026-07-18T00:00:00.000Z'
        );
      `),
    ).toThrow(/CHECK/);

    expect(() =>
      db.exec(`
        INSERT INTO people(id, display_name, status, created_at, updated_at)
        VALUES ('  ','Grace','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      `),
    ).toThrow(/CHECK/);

    expect(() =>
      db.exec(`
        INSERT INTO workspaces(id, kind, name, created_at, updated_at)
        VALUES ('w2','invalid','Invalid','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      `),
    ).toThrow(/CHECK/);

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const workspacesSql = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='workspaces'`,
      )
      .pluck()
      .get() as string;
    const userAccountsSql = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='user_accounts'`,
      )
      .pluck()
      .get() as string;

    expect(workspacesSql).not.toMatch(/REFERENCES\s+organizations/i);
    expect(userAccountsSql).not.toMatch(/REFERENCES\s+users/i);
  });
});
