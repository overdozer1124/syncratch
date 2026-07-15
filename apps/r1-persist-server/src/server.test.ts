import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StubAuthContext } from "@blocksync/auth-context";
import { emptyDocument, richFixtureDocument } from "@blocksync/project-envelope";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteProjectRepository } from "@blocksync/project-store-sqlite";
import { createPersistApp } from "./server.js";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "r1-http-"));
  const repo = openSqliteProjectRepository({ dbPath: join(dir, "p.sqlite") });
  const service = createProjectService({
    auth: new StubAuthContext(),
    repo,
    snapshots: createFsSnapshotStore(join(dir, "snapshots")),
  });
  const app = createPersistApp({ auth: new StubAuthContext(), service });
  return {
    app,
    close: () => repo.close(),
    headers: { "x-user-id": "user-a", "content-type": "application/json" },
  };
}

describe("r1-persist-server", () => {
  it("create, save, get, idempotent replay, schema mismatch, 409", async () => {
    const { app, close, headers } = makeApp();
    try {
      const createdRes = await app.request("/v1/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Demo" }),
      });
      expect(createdRes.status).toBe(201);
      const created = await createdRes.json();

      const saveBody = {
        baseRevision: 0,
        transactionId: "tx-http-1",
        schemaVersion: 1,
        document: richFixtureDocument(),
      };
      const saveRes = await app.request(`/v1/projects/${created.projectId}/document`, {
        method: "PUT",
        headers,
        body: JSON.stringify(saveBody),
      });
      expect(saveRes.status).toBe(200);
      const saved = await saveRes.json();
      expect(saved.revision).toBe(1);

      const replay = await app.request(`/v1/projects/${created.projectId}/document`, {
        method: "PUT",
        headers,
        body: JSON.stringify(saveBody),
      });
      expect(replay.status).toBe(200);
      expect((await replay.json()).revision).toBe(1);

      const mismatch = await app.request(`/v1/projects/${created.projectId}/document`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          baseRevision: 1,
          transactionId: "tx-sv",
          schemaVersion: 2,
          document: emptyDocument(),
        }),
      });
      expect(mismatch.status).toBe(422);
      expect((await mismatch.json()).code).toBe("SCHEMA_VERSION_MISMATCH");

      const stale = await app.request(`/v1/projects/${created.projectId}/document`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          baseRevision: 0,
          transactionId: "tx-stale",
          schemaVersion: 1,
          document: emptyDocument(),
        }),
      });
      expect(stale.status).toBe(409);
      expect((await stale.json()).code).toBe("STALE_REVISION");

      const getRes = await app.request(`/v1/projects/${created.projectId}`, {
        headers,
      });
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).revision).toBe(1);

      const listB = await app.request("/v1/projects", {
        headers: { "x-user-id": "user-b" },
      });
      expect((await listB.json()).projects).toEqual([]);

      const badJson = await app.request("/v1/projects", {
        method: "POST",
        headers,
        body: "{not-json",
      });
      expect(badJson.status).toBe(400);
      expect((await badJson.json()).code).toBe("BAD_REQUEST");
    } finally {
      close();
    }
  });

  it("same head snapshotted twice can both restore", async () => {
    const { app, close, headers } = makeApp();
    try {
      const createdRes = await app.request("/v1/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Snap" }),
      });
      const created = await createdRes.json();
      await app.request(`/v1/projects/${created.projectId}/document`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          baseRevision: 0,
          transactionId: "tx-1",
          schemaVersion: 1,
          document: richFixtureDocument(),
        }),
      });
      const s1 = await (
        await app.request(`/v1/projects/${created.projectId}/snapshots`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).json();
      const s2 = await (
        await app.request(`/v1/projects/${created.projectId}/snapshots`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).json();
      expect(s1.snapshotId).not.toBe(s2.snapshotId);

      await app.request(`/v1/projects/${created.projectId}/document`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          baseRevision: 1,
          transactionId: "tx-2",
          schemaVersion: 1,
          document: emptyDocument(),
        }),
      });

      const r1 = await app.request(`/v1/projects/${created.projectId}/restore`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          snapshotId: s1.snapshotId,
          baseRevision: 2,
          transactionId: "tx-r1",
          schemaVersion: 1,
        }),
      });
      const r2 = await app.request(`/v1/projects/${created.projectId}/restore`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          snapshotId: s2.snapshotId,
          baseRevision: 3,
          transactionId: "tx-r2",
          schemaVersion: 1,
        }),
      });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const e1 = await r1.json();
      const e2 = await r2.json();
      expect(e1.contentHash).toBe(s1.contentHash);
      expect(e2.contentHash).toBe(s2.contentHash);
      expect(e1.revisionMeta.op).toBe("restore");
    } finally {
      close();
    }
  });
});
