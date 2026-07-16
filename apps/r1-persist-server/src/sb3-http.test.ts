import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StubAuthContext } from "@blocksync/auth-context";
import { createAssetFsStore } from "@blocksync/project-assets-fs";
import { customProcedureFixtureDocument } from "@blocksync/project-envelope";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import {
  GLOBAL_DISK_BYTES,
  INITIAL_GLOBAL_RESERVATION_BYTES,
  RESERVATION_TTL_MS,
  computeGlobalUsedBytes,
  openSqliteStore,
} from "@blocksync/project-store-sqlite";
import { exportSb3, type LoadSb3IsolatedOptions } from "@blocksync/sb3-tools";
import Database from "better-sqlite3";
import { bootstrapPersistRuntime } from "./bootstrap.js";
import { createR1DataLayout, measureDataDirFileBytes } from "./data-dir.js";
import { createPersistApp } from "./server.js";

const userA = { headers: { "x-user-id": "user-a" } };
const M = 1024 * 1024;

function seedOrganization(db: Database.Database, orgId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO organizations (id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
  ).run(orgId, orgId, now);
}

async function buildImportSb3Bytes(): Promise<Uint8Array> {
  const backdropSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#e0e0ff"/></svg>`,
  );
  const spriteSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="100"><ellipse cx="48" cy="50" rx="40" ry="45" fill="#ffaa00"/></svg>`,
  );
  const backdropId = createHash("md5").update(backdropSvg).digest("hex");
  const spriteId = createHash("md5").update(spriteSvg).digest("hex");
  const doc = customProcedureFixtureDocument();
  doc.targets[0]!.costumes = [
    {
      kind: "costume",
      name: "backdrop1",
      assetId: backdropId,
      md5ext: `${backdropId}.svg`,
      dataFormat: "svg",
      contentSha256: createHash("sha256").update(backdropSvg).digest("hex"),
      rotationCenterX: 240,
      rotationCenterY: 180,
    },
  ];
  doc.targets[1]!.costumes = [
    {
      kind: "costume",
      name: "costume1",
      assetId: spriteId,
      md5ext: `${spriteId}.svg`,
      dataFormat: "svg",
      contentSha256: createHash("sha256").update(spriteSvg).digest("hex"),
      rotationCenterX: 48,
      rotationCenterY: 50,
    },
  ];
  return exportSb3(
    doc,
    new Map([
      [`${backdropId}.svg`, backdropSvg],
      [`${spriteId}.svg`, spriteSvg],
    ]),
  );
}

function makeSb3App(options?: { isolatedOptions?: LoadSb3IsolatedOptions }) {
  const dir = mkdtempSync(join(tmpdir(), "r1-sb3-http-"));
  const snapDir = join(dir, "snapshots");
  const dbPath = join(dir, "projects.sqlite");
  const store = openSqliteStore({ dbPath });
  seedOrganization(new Database(dbPath), "org-demo");
  store.close();

  const store2 = openSqliteStore({ dbPath });
  const dataLayout = createR1DataLayout(dir);
  const assetFs = createAssetFsStore(dataLayout.assets);
  const assetBytes = {
    readLiveBytes(sha256: string) {
      return assetFs.getLive(sha256);
    },
  };
  const service = createProjectService({
    auth: new StubAuthContext(),
    repo: store2.projectRepo,
    snapshots: createFsSnapshotStore(snapDir),
    commitAssets: store2.commitAssets,
    assetBytes,
    importAtomic: store2.assetRepo,
    idFactory: () => randomUUID(),
  });
  const app = createPersistApp({
    auth: new StubAuthContext(),
    service,
    sb3: {
      assetRepo: store2.assetRepo,
      assetFs,
      dataLayout,
      liveCatalog: store2.liveCatalog,
      idFactory: () => randomUUID(),
      isolatedOptions: options?.isolatedOptions,
    },
  });
  return {
    app,
    assetRepo: store2.assetRepo,
    dataLayout,
    close: () => store2.close(),
  };
}

function multipartBody(title: string, bytes: Uint8Array, boundary: string): BodyInit {
  const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.sb3"\r\nContent-Type: application/zip\r\n\r\n`;
  const suffix = `\r\n--${boundary}--\r\n`;
  const head = new TextEncoder().encode(prefix);
  const tail = new TextEncoder().encode(suffix);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return body;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function preFileAbortBody(boundary: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`--${boundary}\r\n`));
      controller.error(new Error("client aborted"));
    },
  });
}

function midFileAbortBody(
  boundary: string,
  partialBytes: number,
): ReadableStream<Uint8Array> {
  const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nMidAbort\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.sb3"\r\nContent-Type: application/zip\r\n\r\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(prefix));
      controller.enqueue(new Uint8Array(partialBytes).fill(0x41));
      controller.error(new Error("client aborted mid-file"));
    },
  });
}

function streamingImportRequest(
  boundary: string,
  body: ReadableStream<Uint8Array>,
): RequestInit {
  return {
    method: "POST",
    headers: {
      ...userA.headers,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    duplex: "half",
  } as RequestInit;
}

function assertImportPathsClean(dataLayout: ReturnType<typeof createR1DataLayout>): void {
  expect(readdirSync(dataLayout.importSpool)).toEqual([]);
  expect(readdirSync(dataLayout.importHolding)).toEqual([]);
  expect(readdirSync(dataLayout.workerTemp)).toEqual([]);
}

describe("r1-persist-server sb3 HTTP", () => {
  it("imports, exports, and serves head-only asset GET", async () => {
    const { app, close } = makeSb3App();
    try {
      const sb3 = await buildImportSb3Bytes();
      const boundary = "boundary123";
      const imported = await app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody("Imported", sb3, boundary),
      });
      expect(imported.status).toBe(201);
      const envelope = await imported.json();
      expect(envelope.revision).toBe(0);
      expect(envelope.schemaVersion).toBe(2);

      const sha =
        envelope.document.targets[0]!.costumes![0]!.contentSha256;
      const assetRes = await app.request(
        `/v1/projects/${envelope.projectId}/assets/${sha}`,
        { headers: userA.headers },
      );
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("content-type")).toBe("application/octet-stream");
      expect(assetRes.headers.get("x-content-type-options")).toBe("nosniff");

      const exportRes = await app.request(
        `/v1/projects/${envelope.projectId}/export.sb3`,
        { headers: userA.headers },
      );
      expect(exportRes.status).toBe(200);
      expect(exportRes.headers.get("content-type")).toBe("application/zip");
      const exported = new Uint8Array(await exportRes.arrayBuffer());
      expect(exported.byteLength).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it("rejects asset GET when sha is not in head document", async () => {
    const { app, close } = makeSb3App();
    try {
      const sb3 = await buildImportSb3Bytes();
      const boundary = "boundary456";
      const imported = await app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody("Imported", sb3, boundary),
      });
      const envelope = await imported.json();
      const res = await app.request(
        `/v1/projects/${envelope.projectId}/assets/${"a".repeat(64)}`,
        { headers: userA.headers },
      );
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });

  it("parallel global reservations near 2 GiB cap allow exactly one import", async () => {
    const { app, assetRepo, dataLayout, close } = makeSb3App();
    try {
      const fileBytes = measureDataDirFileBytes(dataLayout);
      const sb3 = await buildImportSb3Bytes();
      const casHeadroom = sb3.byteLength + 4 * M;
      assetRepo.createGlobalDiskReservation({
        reservationId: "prefill",
        importSessionId: "prefill-session",
        reservedBytes:
          GLOBAL_DISK_BYTES -
          INITIAL_GLOBAL_RESERVATION_BYTES -
          fileBytes -
          casHeadroom,
        fileBytes,
      });

      const headers = {
        ...userA.headers,
        "content-type": "multipart/form-data; boundary=boundary789",
      };

      const [r1, r2] = await Promise.all([
        app.request("/v1/projects/import", {
          method: "POST",
          headers: { ...headers, "content-type": "multipart/form-data; boundary=par1" },
          body: multipartBody("One", sb3, "par1"),
        }),
        app.request("/v1/projects/import", {
          method: "POST",
          headers: { ...headers, "content-type": "multipart/form-data; boundary=par2" },
          body: multipartBody("Two", sb3, "par2"),
        }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 507]);
    } finally {
      close();
    }
  });

  it("worker timeout releases global disk reservation", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevHooks = process.env.GATE0_TEST_HOOKS;
    process.env.NODE_ENV = "test";
    process.env.GATE0_TEST_HOOKS = "1";
    process.env.GATE0_SB3_WORKER_HOLD_MS = "5000";
    const { app, assetRepo, dataLayout, close } = makeSb3App({
      isolatedOptions: { timeoutMs: 50, workerHoldMs: 5000 },
    });
    try {
      const sb3 = await buildImportSb3Bytes();
      const res = await app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": "multipart/form-data; boundary=timeout1",
        },
        body: multipartBody("Timeout", sb3, "timeout1"),
      });
      expect(res.status).toBe(400);
      expect(
        assetRepo.computeGlobalUsedBytes(
          measureDataDirFileBytes(dataLayout),
          new Date().toISOString(),
        ),
      ).toBe(measureDataDirFileBytes(dataLayout));
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.GATE0_TEST_HOOKS = prevHooks;
      delete process.env.GATE0_SB3_WORKER_HOLD_MS;
      close();
    }
  });

  it("boot reconcile removes expired reservations via bootstrap", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-sb3-reconcile-"));
    const dbPath = join(dir, "projects.sqlite");
    const store = openSqliteStore({ dbPath });
    seedOrganization(new Database(dbPath), "org-demo");
    const now = new Date().toISOString();
    store.assetRepo.createGlobalDiskReservation({
      reservationId: "expired",
      importSessionId: "expired-session",
      reservedBytes: INITIAL_GLOBAL_RESERVATION_BYTES,
      fileBytes: 0,
      now,
    });
    store.close();
    new Database(dbPath)
      .prepare(`UPDATE global_disk_reservations SET expires_at = ?`)
      .run(new Date(Date.parse(now) - RESERVATION_TTL_MS - 1000).toISOString());

    const runtime = bootstrapPersistRuntime(dir, {
      env: { ...process.env, R1_AUTH_MODE: "stub", R1_ALLOWED_ORIGINS: "" },
    });
    try {
      expect(
        new Database(dbPath)
          .prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`)
          .get(),
      ).toEqual({ c: 0 });
    } finally {
      runtime.close();
    }
  });

  it("failed import after quota releases reservations immediately", async () => {
    const prevHooks = process.env.GATE0_TEST_HOOKS;
    const prevStage = process.env.GATE0_IMPORT_FAIL_STAGE;
    process.env.GATE0_TEST_HOOKS = "1";
    process.env.GATE0_IMPORT_FAIL_STAGE = "after-quota";
    const { app, assetRepo, dataLayout, close } = makeSb3App();
    const dbPath = join(dataLayout.root, "projects.sqlite");
    try {
      const sb3 = await buildImportSb3Bytes();
      const res = await app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": "multipart/form-data; boundary=failquota",
        },
        body: multipartBody("FailQuota", sb3, "failquota"),
      });
      expect(res.status).toBe(422);
      const db = new Database(dbPath);
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`).get(),
      ).toEqual({ c: 0 });
      expect(
        db
          .prepare(`SELECT COUNT(*) AS c FROM organization_asset_quota_reservations`)
          .get(),
      ).toEqual({ c: 0 });
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM asset_import_leases`).get(),
      ).toEqual({ c: 0 });
      db.close();
      expect(
        assetRepo.computeGlobalUsedBytes(
          measureDataDirFileBytes(dataLayout),
          new Date().toISOString(),
        ),
      ).toBe(measureDataDirFileBytes(dataLayout));
    } finally {
      process.env.GATE0_TEST_HOOKS = prevHooks;
      if (prevStage === undefined) {
        delete process.env.GATE0_IMPORT_FAIL_STAGE;
      } else {
        process.env.GATE0_IMPORT_FAIL_STAGE = prevStage;
      }
      close();
    }
  });

  it("failed import after CAS releases reservations immediately", async () => {
    const prevHooks = process.env.GATE0_TEST_HOOKS;
    const prevStage = process.env.GATE0_IMPORT_FAIL_STAGE;
    process.env.GATE0_TEST_HOOKS = "1";
    process.env.GATE0_IMPORT_FAIL_STAGE = "after-cas";
    const { app, dataLayout, close } = makeSb3App();
    const dbPath = join(dataLayout.root, "projects.sqlite");
    try {
      const sb3 = await buildImportSb3Bytes();
      const res = await app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": "multipart/form-data; boundary=failcas",
        },
        body: multipartBody("FailCas", sb3, "failcas"),
      });
      expect(res.status).toBe(422);
      const db = new Database(dbPath);
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`).get(),
      ).toEqual({ c: 0 });
      expect(
        db
          .prepare(`SELECT COUNT(*) AS c FROM organization_asset_quota_reservations`)
          .get(),
      ).toEqual({ c: 0 });
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM asset_import_leases`).get(),
      ).toEqual({ c: 0 });
      db.close();
    } finally {
      process.env.GATE0_TEST_HOOKS = prevHooks;
      if (prevStage === undefined) {
        delete process.env.GATE0_IMPORT_FAIL_STAGE;
      } else {
        process.env.GATE0_IMPORT_FAIL_STAGE = prevStage;
      }
      close();
    }
  });

  it("reservation net bytes and file bytes are not double-counted", () => {
    const dir = mkdtempSync(join(tmpdir(), "r1-sb3-accounting-"));
    const store = openSqliteStore({ dbPath: join(dir, "projects.sqlite") });
    seedOrganization(new Database(join(dir, "projects.sqlite")), "org-demo");
    const dataLayout = createR1DataLayout(dir);
    const now = new Date().toISOString();
    const fileBytes = measureDataDirFileBytes(dataLayout);
    store.assetRepo.createGlobalDiskReservation({
      reservationId: "acc",
      importSessionId: "acc-session",
      reservedBytes: 1000,
      fileBytes,
      now,
    });
    store.assetRepo.materializeGlobalDiskReservation({
      importSessionId: "acc-session",
      deltaBytes: 400,
      now,
    });
    const used = store.assetRepo.computeGlobalUsedBytes(
      fileBytes + 400,
      now,
    );
    expect(used).toBe(fileBytes + 400 + (1000 - 400));
    store.close();
  });

  it("aborted upload before file releases reservation and session paths", async () => {
    const { app, assetRepo, dataLayout, close } = makeSb3App();
    const dbPath = join(dataLayout.root, "projects.sqlite");
    const boundary = "abortpre";
    try {
      const res = await Promise.race([
        app.request(
          "/v1/projects/import",
          streamingImportRequest(boundary, preFileAbortBody(boundary)),
        ),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 2000),
        ),
      ]);
      expect(res.status).toBeGreaterThanOrEqual(400);
      const db = new Database(dbPath);
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`).get(),
      ).toEqual({ c: 0 });
      expect(
        db
          .prepare(`SELECT COUNT(*) AS c FROM organization_asset_quota_reservations`)
          .get(),
      ).toEqual({ c: 0 });
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM asset_import_leases`).get(),
      ).toEqual({ c: 0 });
      db.close();
      assertImportPathsClean(dataLayout);
      expect(
        assetRepo.computeGlobalUsedBytes(
          measureDataDirFileBytes(dataLayout),
          new Date().toISOString(),
        ),
      ).toBe(measureDataDirFileBytes(dataLayout));
    } finally {
      close();
    }
  });

  it("aborted upload mid-file releases reservation and session paths", async () => {
    const { app, dataLayout, close } = makeSb3App();
    const dbPath = join(dataLayout.root, "projects.sqlite");
    const boundary = "abortmid";
    try {
      const res = await Promise.race([
        app.request(
          "/v1/projects/import",
          streamingImportRequest(boundary, midFileAbortBody(boundary, 4096)),
        ),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 2000),
        ),
      ]);
      expect(res.status).toBeGreaterThanOrEqual(400);
      const db = new Database(dbPath);
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`).get(),
      ).toEqual({ c: 0 });
      db.close();
      assertImportPathsClean(dataLayout);
    } finally {
      close();
    }
  });

  it("rejects spool junction substitution during worker hold", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevHooks = process.env.GATE0_TEST_HOOKS;
    const prevHold = process.env.GATE0_SB3_WORKER_HOLD_MS;
    process.env.NODE_ENV = "test";
    process.env.GATE0_TEST_HOOKS = "1";
    process.env.GATE0_SB3_WORKER_HOLD_MS = "5000";
    const externalSpoolDir = mkdtempSync(join(tmpdir(), "r1-evil-spool-"));
    const { app, dataLayout, close } = makeSb3App({
      isolatedOptions: { workerHoldMs: 5000, timeoutMs: 15000 },
    });
    try {
      const sb3 = await buildImportSb3Bytes();
      const boundary = "evilspool";
      const responsePromise = app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody("EvilSpool", sb3, boundary),
      });
      await waitFor(() => readdirSync(dataLayout.importSpool).length > 0);
      const spoolName = readdirSync(dataLayout.importSpool)[0]!;
      writeFileSync(
        join(externalSpoolDir, spoolName),
        readFileSync(join(dataLayout.importSpool, spoolName)),
      );
      rmSync(dataLayout.importSpool, { recursive: true, force: true });
      symlinkSync(externalSpoolDir, dataLayout.importSpool, "junction");
      const res = await responsePromise;
      expect(res.status).toBe(400);
      expect(
        new Database(join(dataLayout.root, "projects.sqlite"))
          .prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`)
          .get(),
      ).toEqual({ c: 0 });
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.GATE0_TEST_HOOKS = prevHooks;
      if (prevHold === undefined) {
        delete process.env.GATE0_SB3_WORKER_HOLD_MS;
      } else {
        process.env.GATE0_SB3_WORKER_HOLD_MS = prevHold;
      }
      close();
    }
  }, 20000);

  it("rejects holding junction substitution during manifest hold", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevHooks = process.env.GATE0_TEST_HOOKS;
    const prevManifestHold = process.env.GATE0_SB3_MANIFEST_HOLD_MS;
    process.env.NODE_ENV = "test";
    process.env.GATE0_TEST_HOOKS = "1";
    process.env.GATE0_SB3_MANIFEST_HOLD_MS = "5000";
    const externalDir = mkdtempSync(join(tmpdir(), "r1-evil-holding-"));
    const { app, dataLayout, close } = makeSb3App({
      isolatedOptions: { manifestHoldMs: 5000, timeoutMs: 15000 },
    });
    try {
      const sb3 = await buildImportSb3Bytes();
      const boundary = "evilhold";
      const responsePromise = app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody("EvilHold", sb3, boundary),
      });
      await waitFor(() => readdirSync(dataLayout.importSpool).length > 0);
      await waitFor(() => readdirSync(dataLayout.importHolding).length > 0);
      await new Promise((resolve) => setTimeout(resolve, 800));
      const sessionName = readdirSync(dataLayout.importHolding)[0]!;
      const holdingDir = join(dataLayout.importHolding, sessionName);
      rmSync(holdingDir, { recursive: true, force: true });
      symlinkSync(externalDir, holdingDir, "junction");
      const res = await responsePromise;
      expect(res.status).toBe(400);
      expect(
        new Database(join(dataLayout.root, "projects.sqlite"))
          .prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`)
          .get(),
      ).toEqual({ c: 0 });
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.GATE0_TEST_HOOKS = prevHooks;
      if (prevManifestHold === undefined) {
        delete process.env.GATE0_SB3_MANIFEST_HOLD_MS;
      } else {
        process.env.GATE0_SB3_MANIFEST_HOLD_MS = prevManifestHold;
      }
      close();
    }
  }, 20000);

  it("re-import with existing CAS does not double-count global disk usage", async () => {
    const { app, assetRepo, dataLayout, close } = makeSb3App();
    const dbPath = join(dataLayout.root, "projects.sqlite");
    try {
      const sb3 = await buildImportSb3Bytes();
      const first = await app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": "multipart/form-data; boundary=firstimp",
        },
        body: multipartBody("First", sb3, "firstimp"),
      });
      expect(first.status).toBe(201);

      const now = new Date().toISOString();
      const fileBytesAfterFirst = measureDataDirFileBytes(dataLayout);
      expect(
        assetRepo.computeGlobalUsedBytes(fileBytesAfterFirst, now),
      ).toBe(fileBytesAfterFirst);
      expect(
        new Database(dbPath)
          .prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`)
          .get(),
      ).toEqual({ c: 0 });

      const second = await app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": "multipart/form-data; boundary=secondimp",
        },
        body: multipartBody("Second", sb3, "secondimp"),
      });
      expect(second.status).toBe(201);

      const fileBytesAfterSecond = measureDataDirFileBytes(dataLayout);
      expect(
        assetRepo.computeGlobalUsedBytes(fileBytesAfterSecond, now),
      ).toBe(fileBytesAfterSecond);
      expect(
        new Database(dbPath)
          .prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`)
          .get(),
      ).toEqual({ c: 0 });
    } finally {
      close();
    }
  }, 30000);

  it("loads vendor project1.sb3 when fixture is present", async () => {
    const sb3Path = join(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../vendor/scratch-editor/packages/scratch-gui/test/fixtures/project1.sb3",
    );
    if (!existsSync(sb3Path)) return;

    const { app, close } = makeSb3App();
    try {
      const sb3 = new Uint8Array(readFileSync(sb3Path));
      const boundary = "vendor1";
      const res = await app.request("/v1/projects/import", {
        method: "POST",
        headers: {
          ...userA.headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody("Vendor", sb3, boundary),
      });
      expect(res.status).toBe(201);
    } finally {
      close();
    }
  });
});
