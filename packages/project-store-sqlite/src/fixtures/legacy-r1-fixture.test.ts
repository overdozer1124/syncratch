import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {createLegacyR1Fixture} from "./legacy-r1-fixture.js";

const roots: string[] = [];

describe("legacy R1 fixture builder", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
  });

  it("creates auth, project, revision and snapshot evidence through public APIs", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "legacy-r1-fixture-"));
    roots.push(rootDir);
    const paths = {
      rootDir,
      dbPath: join(rootDir, "projects.sqlite"),
      snapshotDir: join(rootDir, "snapshots"),
    };
    const manifest = await createLegacyR1Fixture(paths);

    expect(manifest.organizations).toHaveLength(1);
    expect(manifest.organizations[0]).toMatchObject({
      name: "Legacy School",
      status: "active"
    });
    expect(manifest.users.map(row => row.id)).toEqual(["user-legacy-owner"]);
    expect(manifest.organizationDomains).toEqual([{
      organizationId: manifest.organizations[0].id,
      hostedDomain: "legacy.school.example"
    }]);
    expect(manifest.projectMembers).toEqual([{
      projectId: "project-legacy-rich",
      userId: "user-legacy-owner",
      role: "owner"
    }]);
    expect(manifest.projects).toEqual([{
      id: "project-legacy-rich",
      organizationId: manifest.organizations[0].id,
      ownerUserId: "user-legacy-owner",
      headRevision: 1
    }]);
    expect(manifest.revisions.map(row => [row.revision, row.clientTransactionId])).toEqual([
      [0, null],
      [1, "tx-legacy-rich"]
    ]);
    expect(manifest.revisions[1]).toMatchObject({
      actorUserId: "user-legacy-owner",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    expect(manifest.snapshots).toHaveLength(1);
    expect(manifest.snapshots[0]).toMatchObject({
      projectId: "project-legacy-rich",
      snapshotId: "snapshot-legacy-rich",
      basedOnRevision: 1,
      reason: "manual",
      createdBy: "user-legacy-owner",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    expect(Object.keys(manifest.snapshotSha256)).toHaveLength(1);

    const schemaDb = new Database(paths.dbPath, {readonly: true});
    try {
      expect(schemaDb.pragma("user_version", {simple: true})).toBe(0);
      expect(
        schemaDb
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'schema_migrations'`,
          )
          .get(),
      ).toBeUndefined();
    } finally {
      schemaDb.close();
    }
  });
});
