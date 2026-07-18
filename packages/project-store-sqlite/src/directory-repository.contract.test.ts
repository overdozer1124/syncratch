import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import Database from "better-sqlite3";
import {copyLegacyR1Fixture} from "./fixtures/legacy-r1-manifest.js";
import {configureSqliteConnection} from "./migrations/configure.js";
import {runSchemaMigrations} from "./migrations/index.js";
import {createSqliteWorkspaceDirectoryRepository} from "./directory-repository.js";

function openMigratedDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  configureSqliteConnection(db);
  runSchemaMigrations(db);
  return db;
}

describe("sqlite workspace directory repository — reads", () => {
  const closers: Array<() => void> = [];

  afterEach(() => {
    while (closers.length) closers.pop()!();
  });

  it("reads backfilled workspace identity rows from a copied legacy fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-read-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    closers.push(() => db.close());
    const repo = createSqliteWorkspaceDirectoryRepository(db);

    repo.withTransaction(tx => {
      const workspaces = db
        .prepare(`SELECT id FROM workspaces ORDER BY id`)
        .all() as Array<{id: string}>;
      expect(workspaces.length).toBeGreaterThan(0);
      const ws = tx.getWorkspace(workspaces[0]!.id);
      expect(ws).not.toBeNull();
      expect(ws!.id).toBe(workspaces[0]!.id);
      expect(["personal", "casual", "school"]).toContain(ws!.kind);

      const rev = tx.getDirectoryRevision(workspaces[0]!.id);
      expect(rev).not.toBeNull();
      expect(rev!.revision).toBeGreaterThanOrEqual(0);

      const people = db
        .prepare(`SELECT id FROM people ORDER BY id`)
        .all() as Array<{id: string}>;
      expect(tx.getPerson(people[0]!.id)?.id).toBe(people[0]!.id);
    });
  });

  it("lists workspaces for an account with an active membership only", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-list-ws-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    closers.push(() => db.close());
    const repo = createSqliteWorkspaceDirectoryRepository(db);

    repo.withTransaction(tx => {
      const row = db
        .prepare(
          `SELECT account_id AS accountId, workspace_id AS workspaceId
           FROM workspace_memberships
           WHERE status = 'active'
           LIMIT 1`,
        )
        .get() as {accountId: string; workspaceId: string};
      const listed = tx.listWorkspacesForAccount(row.accountId);
      expect(listed.some(workspace => workspace.id === row.workspaceId)).toBe(
        true,
      );
    });
  });

  it("gets active person-account links by both account and person", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-active-link-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    closers.push(() => db.close());
    const repo = createSqliteWorkspaceDirectoryRepository(db);

    repo.withTransaction(tx => {
      const row = db
        .prepare(
          `SELECT id, account_id AS accountId, person_id AS personId
           FROM person_account_links
           WHERE status = 'active'
           LIMIT 1`,
        )
        .get() as {id: string; accountId: string; personId: string};

      expect(tx.getActivePersonAccountLinkByAccount(row.accountId)?.id).toBe(
        row.id,
      );
      expect(tx.getActivePersonAccountLinkByPerson(row.personId)?.id).toBe(
        row.id,
      );
    });
  });

  it("excludes ended memberships and workspace roles unless requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-list-history-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    closers.push(() => db.close());
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const source = db
      .prepare(
        `SELECT workspace_id AS workspaceId, account_id AS accountId
         FROM workspace_memberships
         WHERE status = 'active'
         LIMIT 1`,
      )
      .get() as {workspaceId: string; accountId: string};

    db.prepare(
      `INSERT INTO workspace_memberships(
         id, workspace_id, account_id, role, status, started_at, ended_at
       ) VALUES (?, ?, ?, 'guest', 'ended', ?, ?)`,
    ).run(
      "membership-ended-contract",
      source.workspaceId,
      source.accountId,
      "2026-07-16T00:00:00.000Z",
      "2026-07-17T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO role_assignments(
         id, account_id, scope_kind, workspace_id, role, status, started_at, ended_at
       ) VALUES (?, ?, 'workspace', ?, 'guest', 'ended', ?, ?)`,
    ).run(
      "role-ended-contract",
      source.accountId,
      source.workspaceId,
      "2026-07-16T00:00:00.000Z",
      "2026-07-17T00:00:00.000Z",
    );

    repo.withTransaction(tx => {
      const activeWorkspaceMemberships = tx.listMembershipsForWorkspace(
        source.workspaceId,
      );
      const allWorkspaceMemberships = tx.listMembershipsForWorkspace(
        source.workspaceId,
        {includeEnded: true},
      );
      const activeAccountMemberships = tx.listMembershipsForAccount(
        source.accountId,
      );
      const allAccountMemberships = tx.listMembershipsForAccount(
        source.accountId,
        {includeEnded: true},
      );
      const activeRoles = tx.listWorkspaceRoleAssignments(source.workspaceId);
      const allRoles = tx.listWorkspaceRoleAssignments(source.workspaceId, {
        includeEnded: true,
      });

      expect(
        activeWorkspaceMemberships.some(
          membership => membership.id === "membership-ended-contract",
        ),
      ).toBe(false);
      expect(
        allWorkspaceMemberships.some(
          membership => membership.id === "membership-ended-contract",
        ),
      ).toBe(true);
      expect(
        activeAccountMemberships.some(
          membership => membership.id === "membership-ended-contract",
        ),
      ).toBe(false);
      expect(
        allAccountMemberships.some(
          membership => membership.id === "membership-ended-contract",
        ),
      ).toBe(true);
      expect(
        activeRoles.some(role => role.id === "role-ended-contract"),
      ).toBe(false);
      expect(allRoles.some(role => role.id === "role-ended-contract")).toBe(
        true,
      );
    });
  });
});
