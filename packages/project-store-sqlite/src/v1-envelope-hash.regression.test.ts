import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StubAuthContext } from "@blocksync/auth-context";
import {
  contentHash,
  emptyDocument,
  richFixtureDocument,
} from "@blocksync/project-envelope";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteStore } from "./index.js";

/** Pinned in @blocksync/project-envelope — must survive persistence round-trip (§5.2). */
const V1_EMPTY_HASH =
  "0cc517f62f40c66b669ccb7c6c3bf49ec257a12cfc3eea4d74a82315181a5475";
const V1_RICH_HASH =
  "082c3d00ac85531a4e88689c13d1088137569a4fc5bc591b1797871c9cf13128";

const userA = { headers: { "x-user-id": "user-a" } };

describe("V1 envelope hash persistence regression", () => {
  it("empty document hash is pinned before persistence", () => {
    expect(contentHash(emptyDocument())).toBe(V1_EMPTY_HASH);
  });

  it("rich fixture hash survives sqlite save and reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-v1-hash-"));
    const dbPath = join(dir, "projects.sqlite");
    const snapDir = join(dir, "snapshots");
    const doc = richFixtureDocument();
    expect(doc.schemaVersion).toBe(1);
    expect(contentHash(doc)).toBe(V1_RICH_HASH);

    const store1 = openSqliteStore({ dbPath });
    const service1 = createProjectService({
      auth: new StubAuthContext(),
      repo: store1.projectRepo,
      snapshots: createFsSnapshotStore(snapDir),
    });
    const created = await service1.createProject(userA, { title: "V1 hash" });
    const saved = await service1.saveDocument(userA, {
      projectId: created.projectId,
      baseRevision: 0,
      transactionId: "tx-v1-rich",
      schemaVersion: 1,
      document: doc,
    });
    expect(saved.contentHash).toBe(V1_RICH_HASH);
    store1.close();

    const store2 = openSqliteStore({ dbPath });
    const service2 = createProjectService({
      auth: new StubAuthContext(),
      repo: store2.projectRepo,
      snapshots: createFsSnapshotStore(snapDir),
    });
    const head = await service2.getProject(userA, created.projectId);
    expect(head.contentHash).toBe(V1_RICH_HASH);
    store2.close();
  });
});
