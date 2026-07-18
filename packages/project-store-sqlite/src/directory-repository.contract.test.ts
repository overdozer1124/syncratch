import {spawn} from "node:child_process";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";
import Database from "better-sqlite3";
import {
  DirectoryError,
  type Enrollment,
} from "@blocksync/workspace-directory";
import {copyLegacyR1Fixture} from "./fixtures/legacy-r1-manifest.js";
import {configureSqliteConnection} from "./migrations/configure.js";
import {runSchemaMigrations} from "./migrations/index.js";
import {createSqliteWorkspaceDirectoryRepository} from "./directory-repository.js";
import {openSqliteStore} from "./store.js";

function spawnDirectoryCasRace(
  dbPath: string,
  personId: string,
): Promise<{code: number | null; stdout: string; stderr: string}> {
  const childPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "directory-cas-race-child.ts",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", childPath, dbPath, personId],
      {stdio: ["ignore", "pipe", "pipe"]},
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", code => {
      resolve({code, stdout, stderr});
    });
  });
}

function openMigratedDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  configureSqliteConnection(db);
  runSchemaMigrations(db);
  return db;
}

describe("sqlite workspace directory repository - reads", () => {
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
      for (const assignment of allRoles) {
        expect(assignment.scope.kind).toBe("workspace");
        expect(assignment).not.toHaveProperty("workspaceId");
      }
    });
  });
});

describe("sqlite workspace directory repository - writes", () => {
  const closers: Array<() => void> = [];

  afterEach(() => {
    while (closers.length) closers.pop()!();
  });

  function openFixtureDb(prefix: string): {
    db: Database.Database;
    workspaceId: string;
    accountId: string;
    personId: string;
    linkId: string;
    membershipId: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    closers.push(() => db.close());
    const workspaceId = (
      db.prepare(`SELECT id FROM workspaces LIMIT 1`).get() as {id: string}
    ).id;
    const accountId = (
      db.prepare(`SELECT id FROM user_accounts LIMIT 1`).get() as {
        id: string;
      }
    ).id;
    const personId = (
      db.prepare(`SELECT id FROM people LIMIT 1`).get() as {id: string}
    ).id;
    const linkId = (
      db
        .prepare(`SELECT id FROM person_account_links WHERE status = 'active' LIMIT 1`)
        .get() as {id: string}
    ).id;
    const membershipId = (
      db
        .prepare(
          `SELECT id FROM workspace_memberships WHERE status = 'active' LIMIT 1`,
        )
        .get() as {id: string}
    ).id;
    return {db, workspaceId, accountId, personId, linkId, membershipId};
  }

  function openEnrollmentDb(prefix: string) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const db = openMigratedDb(join(dir, "db.sqlite"));
    closers.push(() => db.close());
    db.exec(`
      INSERT INTO workspaces(id, kind, name, created_at, updated_at)
      VALUES
        ('ws-school','school','School','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
        ('ws-foreign','school','Foreign','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
      INSERT INTO workspace_directory_revisions(workspace_id, revision, updated_at)
      VALUES
        ('ws-school',0,'2026-07-18T00:00:00.000Z'),
        ('ws-foreign',0,'2026-07-18T00:00:00.000Z');
      INSERT INTO schools(id, workspace_id, name, created_at, updated_at)
      VALUES
        ('school-1','ws-school','School','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
        ('school-foreign','ws-foreign','Foreign','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
      INSERT INTO academic_years(id, school_id, label, start_date, end_date, status)
      VALUES
        ('year-1','school-1','2026','2026-04-01','2027-03-31','active'),
        ('year-foreign','school-foreign','2026','2026-04-01','2027-03-31','active');
      INSERT INTO grades(id, academic_year_id, code, display_label, sort_order)
      VALUES
        ('grade-1','year-1','1','Grade 1',1),
        ('grade-foreign','year-foreign','1','Grade 1',1);
      INSERT INTO class_groups(id, academic_year_id, grade_id, label)
      VALUES
        ('class-1','year-1','grade-1','Class 1'),
        ('class-foreign','year-foreign','grade-foreign','Foreign Class');
      INSERT INTO people(id, display_name, status, created_at, updated_at)
      VALUES
        ('person-1','Person 1','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
        ('person-2','Person 2','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
        ('person-3','Person 3','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
    `);
    return {
      db,
      dbPath: join(dir, "db.sqlite"),
      repo: createSqliteWorkspaceDirectoryRepository(db),
      workspaceId: "ws-school",
      foreignWorkspaceId: "ws-foreign",
    };
  }

  it("createPerson bumps directory revision under CAS", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-write-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const workspaceId = (
      db.prepare(`SELECT id FROM workspaces LIMIT 1`).get() as {id: string}
    ).id;
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    const person = {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "New Person",
      status: "active" as const,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };

    const result = repo.withTransaction(tx =>
      tx.createPerson({
        workspaceId,
        expectedRevision: before.revision,
        person: person as never,
      }),
    );
    expect(result.revision).toBe(before.revision + 1);
    expect(
      repo.withTransaction(tx => tx.getPerson(person.id))?.displayName,
    ).toBe("New Person");
    db.close();
  });

  it("stale expectedRevision conflicts and rolls back", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-cas-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const workspaceId = (
      db.prepare(`SELECT id FROM workspaces LIMIT 1`).get() as {id: string}
    ).id;
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.createPerson({
          workspaceId,
          expectedRevision: before.revision - 1,
          person: {
            id: "22222222-2222-4222-8222-222222222222",
            displayName: "Nope",
            status: "active",
            createdAt: "2026-07-18T00:00:00.000Z",
            updatedAt: "2026-07-18T00:00:00.000Z",
          } as never,
        }),
      ),
    ).toThrow(DirectoryError);

    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(before.revision);
    expect(
      repo.withTransaction(tx =>
        tx.getPerson("22222222-2222-4222-8222-222222222222"),
      ),
    ).toBeNull();
    db.close();
  });

  it("updatePerson patches fields, bumps revision, and NOT_FOUND on a missing person", () => {
    const {db, workspaceId, personId} = openFixtureDb("dir-update-person-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    const result = repo.withTransaction(tx =>
      tx.updatePerson({
        workspaceId,
        expectedRevision: before.revision,
        personId,
        patch: {displayName: "Renamed Person"},
        updatedAt: "2026-07-18T01:00:00.000Z",
      }),
    );
    expect(result.revision).toBe(before.revision + 1);
    expect(result.person.displayName).toBe("Renamed Person");

    expect(() =>
      repo.withTransaction(tx =>
        tx.updatePerson({
          workspaceId,
          expectedRevision: result.revision,
          personId: "does-not-exist",
          patch: {displayName: "Nope"},
          updatedAt: "2026-07-18T02:00:00.000Z",
        }),
      ),
    ).toThrow(
      expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}),
    );
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(result.revision);
  });

  it("linkPersonAccount bumps revision; a second active link for the same account is DIRECTORY_CONFLICT", () => {
    const {db, workspaceId, accountId} = openFixtureDb("dir-link-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    const newPerson = {
      id: "33333333-3333-4333-8333-333333333333",
      displayName: "Unlinked Person",
      status: "active" as const,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };
    const afterCreate = repo.withTransaction(tx =>
      tx.createPerson({
        workspaceId,
        expectedRevision: before.revision,
        person: newPerson as never,
      }),
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.linkPersonAccount({
          workspaceId,
          expectedRevision: afterCreate.revision,
          link: {
            id: "44444444-4444-4444-8444-444444444444",
            personId: newPerson.id,
            accountId,
            status: "active",
            linkedAt: "2026-07-18T00:00:00.000Z",
            unlinkedAt: null,
          } as never,
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_CONFLICT"}));

    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(afterCreate.revision);
  });

  it("unlinkPersonAccount ends an active link, bumps revision, and NOT_FOUND on a missing link", () => {
    const {db, workspaceId, linkId} = openFixtureDb("dir-unlink-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    const result = repo.withTransaction(tx =>
      tx.unlinkPersonAccount({
        workspaceId,
        expectedRevision: before.revision,
        linkId,
        unlinkedAt: "2026-07-18T00:00:00.000Z",
      }),
    );
    expect(result.revision).toBe(before.revision + 1);
    expect(result.link.status).toBe("unlinked");
    expect(
      repo.withTransaction(tx => tx.getActivePersonAccountLinkByPerson(
        result.link.personId,
      )),
    ).toBeNull();

    expect(() =>
      repo.withTransaction(tx =>
        tx.unlinkPersonAccount({
          workspaceId,
          expectedRevision: result.revision,
          linkId: "does-not-exist",
          unlinkedAt: "2026-07-18T01:00:00.000Z",
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));
  });

  it("createMembership derives its workspace from the membership row and bumps only that revision", () => {
    const {db, workspaceId} = openFixtureDb("dir-create-membership-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const secondAccountId = "second-account-fixture";
    db.prepare(
      `INSERT INTO user_accounts(id, display_name, email, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    ).run(
      secondAccountId,
      "Second Account",
      "second@example.test",
      "2026-07-18T00:00:00.000Z",
      "2026-07-18T00:00:00.000Z",
    );
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    const result = repo.withTransaction(tx =>
      tx.createMembership({
        expectedRevision: before.revision,
        membership: {
          id: "55555555-5555-4555-8555-555555555555",
          workspaceId,
          accountId: secondAccountId,
          role: "member",
          status: "active",
          startedAt: "2026-07-18T00:00:00.000Z",
          endedAt: null,
        } as never,
      }),
    );
    expect(result.revision).toBe(before.revision + 1);
    expect(result.membership.accountId).toBe(secondAccountId);
  });

  it("createEnrollment bumps the workspace revision and round-trips the enrollment", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enrollment-create-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;

    const result = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );

    expect(result.revision).toBe(1);
    expect(
      repo.withTransaction(tx => tx.getEnrollment(workspaceId, enrollment.id)),
    ).toEqual(enrollment);
  });

  it("hides enrollments that belong to another workspace on getEnrollment", () => {
    const {repo, workspaceId, foreignWorkspaceId} = openEnrollmentDb(
      "dir-enrollment-read-bola-",
    );
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;

    repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );

    expect(
      repo.withTransaction(tx =>
        tx.getEnrollment(foreignWorkspaceId, enrollment.id),
      ),
    ).toBeNull();
    expect(
      repo.withTransaction(tx => tx.getEnrollment(workspaceId, enrollment.id)),
    ).toEqual(enrollment);
  });

  it("rejects a duplicate active attendance number without bumping revision or writing the second enrollment", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enrollment-duplicate-");
    const firstEnrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;
    const secondEnrollment = {
      ...firstEnrollment,
      id: "enrollment-2",
      personId: "person-2",
    } as Enrollment;

    const created = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment: firstEnrollment,
      }),
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.createEnrollment({
          workspaceId,
          expectedRevision: created.revision,
          updatedAt: "2026-07-18T02:00:00.000Z",
          enrollment: secondEnrollment,
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_CONFLICT"}));
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(1);
    expect(
      repo.withTransaction(tx => tx.getEnrollment(workspaceId, secondEnrollment.id)),
    ).toBeNull();
  });

  it("allows multiple active enrollments with a null attendance number", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enrollment-null-");
    const firstEnrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: null,
    } as Enrollment;
    const secondEnrollment = {
      ...firstEnrollment,
      id: "enrollment-2",
      personId: "person-2",
    } as Enrollment;

    const first = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment: firstEnrollment,
      }),
    );
    const second = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: first.revision,
        updatedAt: "2026-07-18T02:00:00.000Z",
        enrollment: secondEnrollment,
      }),
    );

    expect(second.revision).toBe(2);
    expect(
      repo.withTransaction(tx => tx.getEnrollment(workspaceId, firstEnrollment.id)),
    ).toEqual(firstEnrollment);
    expect(
      repo.withTransaction(tx => tx.getEnrollment(workspaceId, secondEnrollment.id)),
    ).toEqual(secondEnrollment);
  });

  it("rejects an enrollment whose class belongs to another workspace without changing either revision", () => {
    const {repo, workspaceId, foreignWorkspaceId} = openEnrollmentDb(
      "dir-enrollment-foreign-",
    );
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-foreign",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;

    expect(() =>
      repo.withTransaction(tx =>
        tx.createEnrollment({
          workspaceId,
          expectedRevision: 0,
          updatedAt: "2026-07-18T01:00:00.000Z",
          enrollment,
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(0);
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(foreignWorkspaceId))
        ?.revision,
    ).toBe(0);
    expect(repo.withTransaction(tx => tx.getEnrollment(workspaceId, enrollment.id))).toBeNull();
  });

  it("rejects a stale enrollment write without changing revision or writing the enrollment", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enrollment-stale-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;

    expect(() =>
      repo.withTransaction(tx =>
        tx.createEnrollment({
          workspaceId,
          expectedRevision: -1,
          updatedAt: "2026-07-18T01:00:00.000Z",
          enrollment,
        }),
      ),
    ).toThrow(
      expect.objectContaining({code: "DIRECTORY_REVISION_CONFLICT"}),
    );
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(0);
    expect(repo.withTransaction(tx => tx.getEnrollment(workspaceId, enrollment.id))).toBeNull();
  });

  it("rejects an enrollment write with an invalid updatedAt without changing revision or writing the enrollment", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enrollment-invalid-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;

    expect(() =>
      repo.withTransaction(tx =>
        tx.createEnrollment({
          workspaceId,
          expectedRevision: 0,
          updatedAt: "not-a-utc-date-time",
          enrollment,
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DIRECTORY_INVALID",
        message: expect.stringContaining("UtcDateTime"),
      }),
    );
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(0);
    expect(repo.withTransaction(tx => tx.getEnrollment(workspaceId, enrollment.id))).toBeNull();
  });

  it("updateEnrollment patches attendanceNumber and bumps revision", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enroll-update-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;

    repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );

    const result = repo.withTransaction(tx =>
      tx.updateEnrollment({
        workspaceId,
        expectedRevision: 1,
        updatedAt: "2026-07-18T02:00:00.000Z",
        enrollmentId: enrollment.id,
        patch: {attendanceNumber: "99"},
      }),
    );

    expect(result.revision).toBe(2);
    expect(result.enrollment.attendanceNumber).toBe("99");
    expect(
      repo.withTransaction(tx => tx.getEnrollment(workspaceId, enrollment.id)),
    ).toMatchObject({attendanceNumber: "99", status: "active", endDate: null});
  });

  it("rejects a duplicate active attendance number update without changing the enrollment or revision", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enroll-update-conflict-");
    const firstEnrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;
    const secondEnrollment = {
      ...firstEnrollment,
      id: "enrollment-2",
      personId: "person-2",
      attendanceNumber: "13",
    } as Enrollment;
    const first = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment: firstEnrollment,
      }),
    );
    const second = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: first.revision,
        updatedAt: "2026-07-18T02:00:00.000Z",
        enrollment: secondEnrollment,
      }),
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.updateEnrollment({
          workspaceId,
          expectedRevision: second.revision,
          updatedAt: "2026-07-18T03:00:00.000Z",
          enrollmentId: secondEnrollment.id,
          patch: {attendanceNumber: "12"},
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_CONFLICT"}));
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(second.revision);
    expect(
      repo.withTransaction(tx =>
        tx.getEnrollment(workspaceId, secondEnrollment.id),
      ),
    ).toEqual(secondEnrollment);
  });

  it("endEnrollment ends an active enrollment and bumps revision", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enroll-end-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;
    const created = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );

    const result = repo.withTransaction(tx =>
      tx.endEnrollment({
        workspaceId,
        expectedRevision: created.revision,
        updatedAt: "2026-07-18T02:00:00.000Z",
        enrollmentId: enrollment.id,
        endDate: "2026-07-18",
      }),
    );

    expect(result.revision).toBe(created.revision + 1);
    expect(result.enrollment).toMatchObject({
      status: "ended",
      endDate: "2026-07-18",
    });
  });

  it("rejects update and second end after an enrollment ends without changing revision", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enroll-ended-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;
    const created = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );
    const ended = repo.withTransaction(tx =>
      tx.endEnrollment({
        workspaceId,
        expectedRevision: created.revision,
        updatedAt: "2026-07-18T02:00:00.000Z",
        enrollmentId: enrollment.id,
        endDate: "2026-07-18",
      }),
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.updateEnrollment({
          workspaceId,
          expectedRevision: ended.revision,
          updatedAt: "2026-07-18T03:00:00.000Z",
          enrollmentId: enrollment.id,
          patch: {attendanceNumber: "99"},
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));
    expect(() =>
      repo.withTransaction(tx =>
        tx.endEnrollment({
          workspaceId,
          expectedRevision: ended.revision,
          updatedAt: "2026-07-18T04:00:00.000Z",
          enrollmentId: enrollment.id,
          endDate: "2026-07-18",
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(ended.revision);
  });

  it("rejects foreign workspace enrollment updates and ends without changing either revision", () => {
    const {repo, workspaceId, foreignWorkspaceId} = openEnrollmentDb(
      "dir-enroll-foreign-update-end-",
    );
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;
    const created = repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.updateEnrollment({
          workspaceId: foreignWorkspaceId,
          expectedRevision: 0,
          updatedAt: "2026-07-18T02:00:00.000Z",
          enrollmentId: enrollment.id,
          patch: {attendanceNumber: "99"},
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));
    expect(() =>
      repo.withTransaction(tx =>
        tx.endEnrollment({
          workspaceId: foreignWorkspaceId,
          expectedRevision: 0,
          updatedAt: "2026-07-18T03:00:00.000Z",
          enrollmentId: enrollment.id,
          endDate: "2026-07-18",
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(created.revision);
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(foreignWorkspaceId))
        ?.revision,
    ).toBe(0);
  });

  it("rejects a stale enrollment update without changing revision", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enroll-update-stale-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;
    repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.updateEnrollment({
          workspaceId,
          expectedRevision: -1,
          updatedAt: "2026-07-18T02:00:00.000Z",
          enrollmentId: enrollment.id,
          patch: {attendanceNumber: "99"},
        }),
      ),
    ).toThrow(
      expect.objectContaining({code: "DIRECTORY_REVISION_CONFLICT"}),
    );
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(1);
  });

  it("rejects an enrollment update with an invalid updatedAt without changing revision", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enroll-update-invalid-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;
    repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.updateEnrollment({
          workspaceId,
          expectedRevision: 1,
          updatedAt: "not-a-utc-date-time",
          enrollmentId: enrollment.id,
          patch: {attendanceNumber: "99"},
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DIRECTORY_INVALID",
        message: expect.stringContaining("UtcDateTime"),
      }),
    );
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(1);
  });

  it("rejects empty and unknown enrollment update patches", () => {
    const {repo, workspaceId} = openEnrollmentDb("dir-enroll-update-patch-");
    const enrollment = {
      id: "enrollment-1",
      personId: "person-1",
      classGroupId: "class-1",
      status: "active",
      startDate: "2026-04-01",
      endDate: null,
      attendanceNumber: "12",
    } as Enrollment;
    repo.withTransaction(tx =>
      tx.createEnrollment({
        workspaceId,
        expectedRevision: 0,
        updatedAt: "2026-07-18T01:00:00.000Z",
        enrollment,
      }),
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.updateEnrollment({
          workspaceId,
          expectedRevision: 1,
          updatedAt: "2026-07-18T02:00:00.000Z",
          enrollmentId: enrollment.id,
          patch: {},
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DIRECTORY_INVALID",
        message: expect.stringContaining("patch"),
      }),
    );
    expect(() =>
      repo.withTransaction(tx =>
        tx.updateEnrollment({
          workspaceId,
          expectedRevision: 1,
          updatedAt: "2026-07-18T03:00:00.000Z",
          enrollmentId: enrollment.id,
          patch: {attendanceNumber: "1", classGroupId: "x"} as never,
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DIRECTORY_INVALID",
        message: expect.stringContaining("patch"),
      }),
    );
  });

  it("createMembership with a missing accountId yields DIRECTORY_NOT_FOUND and leaves revision unchanged", () => {
    const {db, workspaceId} = openFixtureDb("dir-fk-membership-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.createMembership({
          expectedRevision: before.revision,
          membership: {
            id: "77777777-7777-4777-8777-777777777777",
            workspaceId,
            accountId: "missing-account-for-fk-test",
            role: "member",
            status: "active",
            startedAt: "2026-07-18T00:00:00.000Z",
            endedAt: null,
          } as never,
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));

    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(before.revision);
    db.close();
  });

  it("duplicate active membership for the same (workspace, account) yields DIRECTORY_CONFLICT", () => {
    const {db, workspaceId, accountId} = openFixtureDb("dir-dup-membership-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.createMembership({
          expectedRevision: before.revision,
          membership: {
            id: "66666666-6666-4666-8666-666666666666",
            workspaceId,
            accountId,
            role: "member",
            status: "active",
            startedAt: "2026-07-18T00:00:00.000Z",
            endedAt: null,
          } as never,
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_CONFLICT"}));

    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(before.revision);
  });

  it("ending a non-existent membership id yields DIRECTORY_NOT_FOUND", () => {
    const {db, workspaceId} = openFixtureDb("dir-end-missing-membership-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.endMembership({
          workspaceId,
          expectedRevision: before.revision,
          membershipId: "does-not-exist",
          endedAt: "2026-07-18T00:00:00.000Z",
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(before.revision);
  });

  it("ending a membership under the wrong workspaceId yields DIRECTORY_NOT_FOUND (BOLA) and bumps nothing", () => {
    const {db, workspaceId, membershipId} = openFixtureDb(
      "dir-end-foreign-membership-",
    );
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const foreignWorkspaceId = "foreign-workspace";
    db.prepare(
      `INSERT INTO workspaces(id, kind, name, created_at, updated_at)
       VALUES (?, 'personal', 'Foreign Workspace', ?, ?)`,
    ).run(
      foreignWorkspaceId,
      "2026-07-18T00:00:00.000Z",
      "2026-07-18T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO workspace_directory_revisions(workspace_id, revision, updated_at)
       VALUES (?, 0, ?)`,
    ).run(foreignWorkspaceId, "2026-07-18T00:00:00.000Z");

    const beforeReal = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );
    const beforeForeign = repo.withTransaction(tx =>
      tx.getDirectoryRevision(foreignWorkspaceId)!,
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.endMembership({
          workspaceId: foreignWorkspaceId,
          expectedRevision: beforeForeign.revision,
          membershipId,
          endedAt: "2026-07-18T00:00:00.000Z",
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));

    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(beforeReal.revision);
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(foreignWorkspaceId))
        ?.revision,
    ).toBe(beforeForeign.revision);
  });

  it("endMembership ends an active non-owner membership and bumps the revision", () => {
    const {db, workspaceId, membershipId} = openFixtureDb(
      "dir-end-membership-",
    );
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const role = (
      db
        .prepare(
          `SELECT role FROM workspace_memberships WHERE id = ? AND workspace_id = ?`,
        )
        .get(membershipId, workspaceId) as {role: string}
    ).role;
    expect(role).not.toBe("owner");
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    const result = repo.withTransaction(tx =>
      tx.endMembership({
        workspaceId,
        expectedRevision: before.revision,
        membershipId,
        endedAt: "2026-07-18T00:00:00.000Z",
      }),
    );
    expect(result.revision).toBe(before.revision + 1);
    expect(result.membership.status).toBe("ended");
    expect(
      repo
        .withTransaction(tx => tx.listMembershipsForWorkspace(workspaceId))
        .some(m => m.id === membershipId),
    ).toBe(false);
  });

  it("ending the sole active owner membership yields DIRECTORY_LAST_OWNER and leaves revision unchanged", () => {
    const {db, workspaceId, membershipId} = openFixtureDb(
      "dir-last-owner-",
    );
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    db.prepare(
      `UPDATE workspace_memberships SET role = 'owner'
       WHERE id = ? AND workspace_id = ?`,
    ).run(membershipId, workspaceId);
    const ownerCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM workspace_memberships
           WHERE workspace_id = ? AND status = 'active' AND role = 'owner'`,
        )
        .get(workspaceId) as {count: number}
    ).count;
    expect(ownerCount).toBe(1);

    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.endMembership({
          workspaceId,
          expectedRevision: before.revision,
          membershipId,
          endedAt: "2026-07-18T00:00:00.000Z",
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_LAST_OWNER"}));

    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(before.revision);
    expect(
      (
        db
          .prepare(
            `SELECT status FROM workspace_memberships WHERE id = ?`,
          )
          .get(membershipId) as {status: string}
      ).status,
    ).toBe("active");
  });

  it("ending one owner succeeds when another active owner remains", () => {
    const {db, workspaceId, membershipId} = openFixtureDb(
      "dir-second-owner-",
    );
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    db.prepare(
      `UPDATE workspace_memberships SET role = 'owner'
       WHERE id = ? AND workspace_id = ?`,
    ).run(membershipId, workspaceId);
    const secondAccountId = "second-owner-account";
    db.prepare(
      `INSERT INTO user_accounts(id, display_name, email, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    ).run(
      secondAccountId,
      "Second Owner",
      "second-owner@example.test",
      "2026-07-18T00:00:00.000Z",
      "2026-07-18T00:00:00.000Z",
    );
    const beforeCreate = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );
    const afterCreate = repo.withTransaction(tx =>
      tx.createMembership({
        expectedRevision: beforeCreate.revision,
        membership: {
          id: "88888888-8888-4888-8888-888888888888",
          workspaceId,
          accountId: secondAccountId,
          role: "owner",
          status: "active",
          startedAt: "2026-07-18T00:00:00.000Z",
          endedAt: null,
        } as never,
      }),
    );
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM workspace_memberships
             WHERE workspace_id = ? AND status = 'active' AND role = 'owner'`,
          )
          .get(workspaceId) as {count: number}
      ).count,
    ).toBe(2);

    const result = repo.withTransaction(tx =>
      tx.endMembership({
        workspaceId,
        expectedRevision: afterCreate.revision,
        membershipId,
        endedAt: "2026-07-18T01:00:00.000Z",
      }),
    );
    expect(result.revision).toBe(afterCreate.revision + 1);
    expect(result.membership.status).toBe("ended");
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM workspace_memberships
             WHERE workspace_id = ? AND status = 'active' AND role = 'owner'`,
          )
          .get(workspaceId) as {count: number}
      ).count,
    ).toBe(1);
  });

  it("grantWorkspaceRole / endWorkspaceRole bump revision; duplicate active grant is DIRECTORY_CONFLICT", () => {
    const {db, workspaceId, accountId} = openFixtureDb("dir-role-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    const granted = repo.withTransaction(tx =>
      tx.grantWorkspaceRole({
        expectedRevision: before.revision,
        assignment: {
          id: "77777777-7777-4777-8777-777777777777",
          accountId,
          status: "active",
          startedAt: "2026-07-18T00:00:00.000Z",
          endedAt: null,
          scope: {kind: "workspace", workspaceId},
          role: "guest",
        } as never,
      }),
    );
    expect(granted.revision).toBe(before.revision + 1);
    expect(granted.assignment.role).toBe("guest");

    expect(() =>
      repo.withTransaction(tx =>
        tx.grantWorkspaceRole({
          expectedRevision: granted.revision,
          assignment: {
            id: "88888888-8888-4888-8888-888888888888",
            accountId,
            status: "active",
            startedAt: "2026-07-18T00:00:00.000Z",
            endedAt: null,
            scope: {kind: "workspace", workspaceId},
            role: "guest",
          } as never,
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_CONFLICT"}));

    const ended = repo.withTransaction(tx =>
      tx.endWorkspaceRole({
        workspaceId,
        expectedRevision: granted.revision,
        assignmentId: "77777777-7777-4777-8777-777777777777",
        endedAt: "2026-07-18T01:00:00.000Z",
      }),
    );
    expect(ended.revision).toBe(granted.revision + 1);
    expect(ended.assignment.status).toBe("ended");
  });

  it("endWorkspaceRole under the wrong workspaceId yields DIRECTORY_NOT_FOUND (BOLA)", () => {
    const {db, workspaceId, accountId} = openFixtureDb("dir-role-bola-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );
    const granted = repo.withTransaction(tx =>
      tx.grantWorkspaceRole({
        expectedRevision: before.revision,
        assignment: {
          id: "99999999-9999-4999-8999-999999999999",
          accountId,
          status: "active",
          startedAt: "2026-07-18T00:00:00.000Z",
          endedAt: null,
          scope: {kind: "workspace", workspaceId},
          role: "guest",
        } as never,
      }),
    );

    const foreignWorkspaceId = "foreign-workspace-role";
    db.prepare(
      `INSERT INTO workspaces(id, kind, name, created_at, updated_at)
       VALUES (?, 'personal', 'Foreign Workspace', ?, ?)`,
    ).run(
      foreignWorkspaceId,
      "2026-07-18T00:00:00.000Z",
      "2026-07-18T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO workspace_directory_revisions(workspace_id, revision, updated_at)
       VALUES (?, 0, ?)`,
    ).run(foreignWorkspaceId, "2026-07-18T00:00:00.000Z");

    expect(() =>
      repo.withTransaction(tx =>
        tx.endWorkspaceRole({
          workspaceId: foreignWorkspaceId,
          expectedRevision: 0,
          assignmentId: "99999999-9999-4999-8999-999999999999",
          endedAt: "2026-07-18T02:00:00.000Z",
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));

    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(granted.revision);
  });

  it("createWorkspace inserts a workspace and its revision row on a fresh empty database", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-create-workspace-"));
    const dbPath = join(dir, "fresh.sqlite");
    const db = openMigratedDb(dbPath);
    closers.push(() => db.close());
    const repo = createSqliteWorkspaceDirectoryRepository(db);

    const result = repo.withTransaction(tx =>
      tx.createWorkspace({
        workspace: {
          id: "fresh-workspace",
          kind: "personal",
          name: "Fresh Workspace",
          createdAt: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
        } as never,
      }),
    );
    expect(result.revision).toBe(0);

    const stored = repo.withTransaction(tx => tx.getWorkspace("fresh-workspace"));
    expect(stored?.name).toBe("Fresh Workspace");
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision("fresh-workspace")),
    ).toEqual({revision: 0, updatedAt: "2026-07-18T00:00:00.000Z"});
  });

  it("maps a two-connection CAS race loser to DIRECTORY_REVISION_CONFLICT with no loser DML", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-cas-race-"));
    const dbPath = join(dir, "db.sqlite");
    const seed = openMigratedDb(dbPath);
    seed.exec(`
      INSERT INTO workspaces(id, kind, name, created_at, updated_at)
      VALUES ('ws-cas','personal','CAS','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
      INSERT INTO workspace_directory_revisions(workspace_id, revision, updated_at)
      VALUES ('ws-cas',0,'2026-07-18T00:00:00.000Z');
    `);
    seed.close();

    const [first, second] = await Promise.all([
      spawnDirectoryCasRace(dbPath, "person-race-a"),
      spawnDirectoryCasRace(dbPath, "person-race-b"),
    ]);

    expect(first.stderr).toBe("");
    expect(second.stderr).toBe("");
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);

    const results = [JSON.parse(first.stdout), JSON.parse(second.stdout)] as Array<{
      ok: boolean;
      code?: string;
    }>;
    const successes = results.filter(result => result.ok);
    const conflicts = results.filter(
      result => !result.ok && result.code === "DIRECTORY_REVISION_CONFLICT",
    );
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const verify = openMigratedDb(dbPath);
    closers.push(() => verify.close());
    const repo = createSqliteWorkspaceDirectoryRepository(verify);
    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision("ws-cas"))?.revision,
    ).toBe(1);
    const people = verify
      .prepare(`SELECT id FROM people WHERE id LIKE 'person-race-%' ORDER BY id`)
      .all() as Array<{id: string}>;
    expect(people).toHaveLength(1);
  });
});

describe("openSqliteStore directory repository", () => {
  it("exposes directoryRepo on the shared connection", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-store-"));
    const store = openSqliteStore({dbPath: join(dir, "db.sqlite")});
    try {
      const created = store.directoryRepo.withTransaction(tx =>
        tx.createWorkspace({
          workspace: {
            id: "ws-smoke",
            kind: "personal",
            name: "Smoke",
            createdAt: "2026-07-18T00:00:00.000Z",
            updatedAt: "2026-07-18T00:00:00.000Z",
          } as never,
        }),
      );
      expect(created.revision).toBe(0);
      expect(
        store.directoryRepo.withTransaction(tx => tx.getWorkspace("ws-smoke"))
          ?.name,
      ).toBe("Smoke");
    } finally {
      store.close();
    }
  });
});
