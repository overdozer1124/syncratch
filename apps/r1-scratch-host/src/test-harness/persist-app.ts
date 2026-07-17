/**
 * In-process Persist app harness for narrow-host integration tests.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { StubAuthContext } from "@blocksync/auth-context";
import { createAssetFsStore } from "@blocksync/project-assets-fs";
import type { ProjectDocument } from "@blocksync/project-schema";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteStore } from "@blocksync/project-store-sqlite";
import { exportSb3 } from "@blocksync/sb3-tools";
import { createPersistApp } from "@blocksync/r1-persist-server";
import { createR1DataLayout } from "@blocksync/r1-persist-server/data-dir";

function seedOrganization(db: Database.Database, orgId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO organizations (id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
  ).run(orgId, orgId, now);
}

function minimalDocument(
  backdropId: string,
  spriteId: string,
  backdropSha: string,
  spriteSha: string,
): ProjectDocument {
  return {
    schemaVersion: 2,
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "backdrop1",
            assetId: backdropId,
            md5ext: `${backdropId}.svg`,
            dataFormat: "svg",
            contentSha256: backdropSha,
            rotationCenterX: 240,
            rotationCenterY: 180,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null,
      },
      {
        id: "sprite1",
        name: "Sprite1",
        isStage: false,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "costume1",
            assetId: spriteId,
            md5ext: `${spriteId}.svg`,
            dataFormat: "svg",
            contentSha256: spriteSha,
            rotationCenterX: 48,
            rotationCenterY: 50,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 1,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: "all around",
      },
    ],
    extensions: [],
    monitors: [],
    meta: {
      semver: "3.0.0",
      vm: "14.1.0",
      agent: "blocksync-narrow-host-test",
    },
  };
}

export async function buildImportSb3Bytes(): Promise<Uint8Array> {
  const backdropSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#e0e0ff"/></svg>`,
  );
  const spriteSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="100"><ellipse cx="48" cy="50" rx="40" ry="45" fill="#ffaa00"/></svg>`,
  );
  const backdropId = createHash("md5").update(backdropSvg).digest("hex");
  const spriteId = createHash("md5").update(spriteSvg).digest("hex");
  const backdropSha = createHash("sha256").update(backdropSvg).digest("hex");
  const spriteSha = createHash("sha256").update(spriteSvg).digest("hex");
  const doc = minimalDocument(backdropId, spriteId, backdropSha, spriteSha);
  return exportSb3(
    doc,
    new Map([
      [`${backdropId}.svg`, backdropSvg],
      [`${spriteId}.svg`, spriteSvg],
    ]),
  );
}

export function makeNarrowHostApp() {
  const dir = mkdtempSync(join(tmpdir(), "r1-narrow-host-"));
  const snapDir = join(dir, "snapshots");
  const dbPath = join(dir, "projects.sqlite");
  const store = openSqliteStore({ dbPath });
  seedOrganization(new Database(dbPath), "org-demo");
  store.close();

  const store2 = openSqliteStore({ dbPath });
  const dataLayout = createR1DataLayout(dir);
  const assetFs = createAssetFsStore(dataLayout.assets);
  const service = createProjectService({
    auth: new StubAuthContext(),
    repo: store2.projectRepo,
    snapshots: createFsSnapshotStore(snapDir),
    commitAssets: store2.commitAssets,
    assetBytes: {
      readLiveBytes(sha256: string) {
        return assetFs.getLive(sha256);
      },
    },
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
    },
  });

  return {
    app,
    close: () => store2.close(),
    buildImportSb3Bytes,
  };
}
