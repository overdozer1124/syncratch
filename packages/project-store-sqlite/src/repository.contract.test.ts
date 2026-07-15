import { mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StubAuthContext } from "@blocksync/auth-context";
import {
  emptyDocument,
  richFixtureDocument,
} from "@blocksync/project-envelope";
import {
  NotFoundError,
  StaleRevisionError,
  createProjectService,
} from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteProjectRepository } from "./index.js";

const userA = { headers: { "x-user-id": "user-a" } };

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("sqlite project repository contracts", () => {
  it("survives reopen on same db file", async () => {
    const dir = tempDir("r1-db-");
    const dbPath = join(dir, "projects.sqlite");
    const snapDir = join(dir, "snapshots");

    const repo1 = openSqliteProjectRepository({ dbPath });
    const service1 = createProjectService({
      auth: new StubAuthContext(),
      repo: repo1,
      snapshots: createFsSnapshotStore(snapDir),
    });
    const created = await service1.createProject(userA, { title: "Persist" });
    const saved = await service1.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-persist",
      schemaVersion: 1,
      document: richFixtureDocument(),
    });
    repo1.close();

    const repo2 = openSqliteProjectRepository({ dbPath });
    const service2 = createProjectService({
      auth: new StubAuthContext(),
      repo: repo2,
      snapshots: createFsSnapshotStore(snapDir),
    });
    const head = await service2.getProject(userA, created.projectId);
    expect(head.revision).toBe(saved.revision);
    expect(head.contentHash).toBe(saved.contentHash);
    repo2.close();
  });

  it("CAS: concurrent same-base saves — one success, one stale", async () => {
    const dir = tempDir("r1-cas-");
    const repo = openSqliteProjectRepository({
      dbPath: join(dir, "projects.sqlite"),
    });
    const service = createProjectService({
      auth: new StubAuthContext(),
      repo,
      snapshots: createFsSnapshotStore(join(dir, "snapshots")),
    });
    const created = await service.createProject(userA, { title: "CAS" });
    const docA = richFixtureDocument();
    const docB = emptyDocument();

    const results = await Promise.allSettled([
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-a",
        schemaVersion: 1,
        document: docA,
      }),
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-b",
        schemaVersion: 1,
        document: docB,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      StaleRevisionError,
    );
    const head = await service.getProject(userA, created.projectId);
    expect(head.revision).toBe(1);
    repo.close();
  });

  it("rolls back when callback throws after partial mutation", () => {
    const dir = tempDir("r1-rb-");
    const repo = openSqliteProjectRepository({
      dbPath: join(dir, "projects.sqlite"),
    });

    repo.withTransaction((tx) => {
      tx.createProject({
        projectId: "p-rb",
        organizationId: "org-demo",
        ownerUserId: "user-a",
        title: "rb",
        envelope: {
          format: "blocksync.project/v1",
          projectId: "p-rb",
          organizationId: "org-demo",
          title: "rb",
          revision: 0,
          schemaVersion: 1,
          contentHash: "x".repeat(64),
          updatedAt: "2026-07-15T00:00:00.000Z",
          updatedByUserId: "user-a",
          document: emptyDocument(),
        },
      });
    });

    const before = repo.withTransaction((tx) => tx.getHead("p-rb"));
    expect(before?.revision).toBe(0);

    expect(() =>
      repo.withTransaction((tx) => {
        tx.commitRevision({
          projectId: "p-rb",
          baseRevision: 0,
          transactionId: "tx-partial",
          contentHash: "y".repeat(64),
          requestHash: "z".repeat(64),
          envelope: {
            ...before!,
            revision: 1,
            contentHash: "y".repeat(64),
            document: richFixtureDocument(),
            updatedAt: "2026-07-15T00:00:01.000Z",
          },
        });
        throw new Error("FORCED_ROLLBACK");
      }),
    ).toThrow(/FORCED_ROLLBACK/);

    const after = repo.withTransaction((tx) => tx.getHead("p-rb"));
    expect(after?.revision).toBe(0);
    expect(after?.contentHash).toBe(before?.contentHash);
    repo.close();
  });

  it("restore replay returns stored envelope after blob deletion", async () => {
    const dir = tempDir("r1-restore-replay-");
    const snapDir = join(dir, "snapshots");
    const repo = openSqliteProjectRepository({
      dbPath: join(dir, "projects.sqlite"),
    });
    const snapshots = createFsSnapshotStore(snapDir);
    const service = createProjectService({
      auth: new StubAuthContext(),
      repo,
      snapshots,
    });
    const created = await service.createProject(userA, { title: "Replay" });
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-1",
      schemaVersion: 1,
      document: richFixtureDocument(),
    });
    const snap = await service.createSnapshot(userA, {
      projectId: created.projectId,
    });
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 1,
      transactionId: "tx-2",
      schemaVersion: 1,
      document: emptyDocument(),
    });
    const first = await service.restoreSnapshot(userA, {
      projectId: created.projectId,
      snapshotId: snap.snapshotId,
      baseRevision: 2,
      transactionId: "tx-restore-idem",
      schemaVersion: 1,
    });
    unlinkSync(join(snapDir, snap.storageKey));

    const replay = await service.restoreSnapshot(userA, {
      projectId: created.projectId,
      snapshotId: snap.snapshotId,
      baseRevision: 2,
      transactionId: "tx-restore-idem",
      schemaVersion: 1,
    });
    expect(replay.revision).toBe(first.revision);
    expect(replay.contentHash).toBe(first.contentHash);
    repo.close();
  });

  it("same head can be snapshotted twice and both restores work", async () => {
    const dir = tempDir("r1-snap2-");
    const repo = openSqliteProjectRepository({
      dbPath: join(dir, "projects.sqlite"),
    });
    const service = createProjectService({
      auth: new StubAuthContext(),
      repo,
      snapshots: createFsSnapshotStore(join(dir, "snapshots")),
    });
    const created = await service.createProject(userA, { title: "S" });
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-1",
      schemaVersion: 1,
      document: richFixtureDocument(),
    });
    const first = await service.createSnapshot(userA, {
      projectId: created.projectId,
    });
    const second = await service.createSnapshot(userA, {
      projectId: created.projectId,
    });
    expect(first.storageKey).toBe(second.storageKey);

    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 1,
      transactionId: "tx-2",
      schemaVersion: 1,
      document: emptyDocument(),
    });
    const r1 = await service.restoreSnapshot(userA, {
      projectId: created.projectId,
      snapshotId: first.snapshotId,
      baseRevision: 2,
      transactionId: "tx-r1",
      schemaVersion: 1,
    });
    const r2 = await service.restoreSnapshot(userA, {
      projectId: created.projectId,
      snapshotId: second.snapshotId,
      baseRevision: 3,
      transactionId: "tx-r2",
      schemaVersion: 1,
    });
    expect(r1.contentHash).toBe(first.contentHash);
    expect(r2.contentHash).toBe(second.contentHash);
    expect(r1.revisionMeta).toEqual({
      op: "restore",
      snapshotId: first.snapshotId,
    });
    repo.close();
  });

  it("BOLA: cannot restore other project's snapshot id", async () => {
    const dir = tempDir("r1-bola-");
    const repo = openSqliteProjectRepository({
      dbPath: join(dir, "projects.sqlite"),
    });
    const service = createProjectService({
      auth: new StubAuthContext(),
      repo,
      snapshots: createFsSnapshotStore(join(dir, "snapshots")),
    });

    const a = await service.createProject(userA, {
      title: "A",
      projectId: "proj-a",
    });
    const b = await service.createProject(userA, {
      title: "B",
      projectId: "proj-b",
    });
    await service.saveDocument(userA, {
      projectId: a.projectId,
      baseRevision: 0,
      transactionId: "tx-a",
      schemaVersion: 1,
      document: richFixtureDocument(),
    });
    const snap = await service.createSnapshot(userA, { projectId: a.projectId });

    await expect(
      service.restoreSnapshot(userA, {
        projectId: b.projectId,
        snapshotId: snap.snapshotId,
        baseRevision: 0,
        transactionId: "tx-bola",
        schemaVersion: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    repo.close();
  });
});
