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
    } finally {
      close();
    }
  });
});
