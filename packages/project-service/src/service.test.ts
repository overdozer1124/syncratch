import { describe, expect, it } from "vitest";
import { StubAuthContext } from "@blocksync/auth-context";
import {
  contentHash,
  emptyDocument,
  richFixtureDocument,
} from "@blocksync/project-envelope";
import {
  SchemaInvalidError,
  SchemaVersionMismatchError,
  StaleRevisionError,
  TransactionPayloadMismatchError,
  NotFoundError,
  createMemoryProjectRepository,
  createMemorySnapshotStore,
  createProjectService,
} from "./index.js";

const userA = { headers: { "x-user-id": "user-a" } };
const userB = { headers: { "x-user-id": "user-b" } };

function makeService() {
  const repo = createMemoryProjectRepository();
  const snapshots = createMemorySnapshotStore();
  const service = createProjectService({
    auth: new StubAuthContext(),
    repo,
    snapshots,
    now: () => new Date("2026-07-15T00:00:00.000Z"),
    idFactory: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  return { service, repo, snapshots };
}

describe("project-service", () => {
  it("lists only member projects for same-org users", async () => {
    const { service } = makeService();
    await service.createProject(userA, { title: "A" });
    const listA = await service.listProjects(userA);
    const listB = await service.listProjects(userB);
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(0);
  });

  it("denies non-member get/save", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    await expect(service.getProject(userB, created.projectId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      service.saveDocument(userB, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "t1",
        schemaVersion: 1,
        document: richFixtureDocument(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("idempotent save returns same revision without bump", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    const doc = richFixtureDocument();
    const first = await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-1",
      schemaVersion: 1,
      document: doc,
    });
    expect(first.revision).toBe(1);
    const second = await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-1",
      schemaVersion: 1,
      document: doc,
    });
    expect(second.revision).toBe(1);
    expect(second.contentHash).toBe(first.contentHash);
    const head = await service.getProject(userA, created.projectId);
    expect(head.revision).toBe(1);
  });

  it("same transactionId with different schemaVersion mismatches", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    const doc = emptyDocument();
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-sv",
      schemaVersion: 1,
      document: doc,
    });
    const badDoc = { ...doc, schemaVersion: 2 };
    // schema mismatch vs document fails first when client lies inconsistently;
    // use matching document schema but different request schema via clone trick:
    // For mismatch after success, re-send same doc with different schemaVersion that equals doc —
    // need same document bytes but different schemaVersion in request → SchemaVersionMismatch.
    // Plan: same transactionId, same document, different schemaVersion that still equals document
    // is impossible. So change only request schemaVersion with matching doc.schemaVersion change
    // after first save — document hash would also change. Explicit case from plan:
    // "same transactionId, same document, different schemaVersion"
    // That means payload material differs while contentHash of doc may be same if schemaVersion
    // is also in document — so contentHash changes too. requestHash still mismatches first.
    // Simulate by calling find path: recreate with altered schemaVersion on same doc identity
    // after first commit — recompute with doc.schemaVersion=1 and request schemaVersion=1 succeeded;
    // second call with schemaVersion=1 and mutated meta still same content is hard.
    // Direct case: second call uses schemaVersion 1 and a copy of doc with schemaVersion 1 but
    // content change → TransactionPayloadMismatch.

    const other = structuredClone(doc);
    other.meta = { x: 1 };
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-sv",
        schemaVersion: 1,
        document: other,
      }),
    ).rejects.toBeInstanceOf(TransactionPayloadMismatchError);

    // schemaVersion-only change: same content fields but different schemaVersion on document
    // changes contentHash AND request schemaVersion → mismatch
    const sv2 = structuredClone(doc);
    sv2.schemaVersion = 2;
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-sv",
        schemaVersion: 2,
        document: sv2,
      }),
    ).rejects.toBeInstanceOf(TransactionPayloadMismatchError);
  });

  it("rejects client schemaVersion !== document.schemaVersion", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-mm",
        schemaVersion: 2,
        document: emptyDocument(),
      }),
    ).rejects.toBeInstanceOf(SchemaVersionMismatchError);
  });

  it("stale revision leaves head unchanged", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    const doc = richFixtureDocument();
    await service.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-ok",
      schemaVersion: 1,
      document: doc,
    });
    const headBefore = await service.getProject(userA, created.projectId);
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-stale",
        schemaVersion: 1,
        document: emptyDocument(),
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    const headAfter = await service.getProject(userA, created.projectId);
    expect(headAfter.revision).toBe(headBefore.revision);
    expect(headAfter.contentHash).toBe(headBefore.contentHash);
  });

  it("rejects invalid document", async () => {
    const { service } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-bad",
        schemaVersion: 1,
        document: {
          schemaVersion: 1,
          targets: [
            {
              id: "s1",
              name: "S",
              isStage: false,
              blocks: {
                a: {
                  id: "mismatch",
                  opcode: "event_whenflagclicked",
                  next: null,
                  parent: null,
                  inputs: {},
                  fields: {},
                  topLevel: true,
                },
              },
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(SchemaInvalidError);
  });

  it("snapshot restore creates new revision; BOLA across projects fails", async () => {
    const { service } = makeService();
    const a = await service.createProject(userA, { title: "A", projectId: "proj-a" });
    const b = await service.createProject(userA, { title: "B", projectId: "proj-b" });
    const snapDoc = richFixtureDocument();
    await service.saveDocument(userA, {
      projectId: a.projectId,
      baseRevision: 0,
      transactionId: "tx-a1",
      schemaVersion: 1,
      document: snapDoc,
    });
    const snap = await service.createSnapshot(userA, { projectId: a.projectId });

    await service.saveDocument(userA, {
      projectId: a.projectId,
      baseRevision: 1,
      transactionId: "tx-a2",
      schemaVersion: 1,
      document: emptyDocument(),
    });

    const restored = await service.restoreSnapshot(userA, {
      projectId: a.projectId,
      snapshotId: snap.snapshotId,
      baseRevision: 2,
      transactionId: "tx-restore",
      schemaVersion: 1,
    });
    expect(restored.revision).toBe(3);
    expect(restored.contentHash).toBe(contentHash(snapDoc));

    await expect(
      service.restoreSnapshot(userA, {
        projectId: b.projectId,
        snapshotId: snap.snapshotId,
        baseRevision: 0,
        transactionId: "tx-bola",
        schemaVersion: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rolls back memory transaction on forced error", async () => {
    const { service, repo } = makeService();
    const created = await service.createProject(userA, { title: "A" });
    repo.failNextTransaction = true;
    await expect(
      service.saveDocument(userA, {
        projectId: created.projectId,
        baseRevision: 0,
        transactionId: "tx-rb",
        schemaVersion: 1,
        document: richFixtureDocument(),
      }),
    ).rejects.toThrow(/FORCED_ROLLBACK/);
    const head = await service.getProject(userA, created.projectId);
    expect(head.revision).toBe(0);
  });
});
