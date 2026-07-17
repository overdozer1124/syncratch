import {mkdirSync} from "node:fs";
import type {AuthContext, AuthPrincipal, AuthRequestHints} from "@blocksync/auth-context";
import {richFixtureDocument} from "@blocksync/project-envelope";
import {createProjectService} from "@blocksync/project-service";
import {createFsSnapshotStore} from "@blocksync/project-snapshots-fs";
import {openLegacyR1StoreForFixture} from "../store.js";
import {
  readLegacyR1Manifest,
  type LegacyR1Manifest,
} from "./legacy-r1-manifest.js";

export interface LegacyFixturePaths {
  rootDir: string;
  dbPath: string;
  snapshotDir: string;
}

const NOW = new Date("2026-07-17T00:00:00.000Z");
const USER_ID = "user-legacy-owner";
const PROJECT_ID = "project-legacy-rich";
const SESSION_ID_HASH = "a".repeat(64);
const CSRF_HASH = "b".repeat(64);
const SNAPSHOT_ID = "snapshot-legacy-rich";

class LegacyFixtureAuthContext implements AuthContext {
  constructor(private readonly organizationId: string) {}

  async resolve(_request: AuthRequestHints): Promise<AuthPrincipal> {
    return {
      userId: USER_ID,
      organizationId: this.organizationId,
      displayName: "Legacy Owner",
    };
  }
}

export async function createLegacyR1Fixture(
  paths: LegacyFixturePaths,
): Promise<LegacyR1Manifest> {
  mkdirSync(paths.rootDir, {recursive: true});

  const store = openLegacyR1StoreForFixture({dbPath: paths.dbPath});
  try {
    const organizationId = store.authRepo.withTransaction(tx => {
      const id = tx.ensureOrgForHostedDomain(
        "legacy.school.example",
        "Legacy School",
      );
      tx.createUser({
        userId: USER_ID,
        primaryOrganizationId: id,
        email: "owner@legacy.school.example",
        displayName: "Legacy Owner",
        now: NOW.toISOString(),
      });
      tx.ensureMembership(id, USER_ID, "admin");
      tx.insertExternalIdentity({
        provider: "google",
        subject: "legacy-google-subject",
        userId: USER_ID,
        organizationId: id,
        createdAt: NOW.toISOString(),
      });
      tx.createSession({
        idHash: SESSION_ID_HASH,
        userId: USER_ID,
        organizationId: id,
        csrfHash: CSRF_HASH,
        createdAt: NOW.toISOString(),
        expiresAt: "2026-07-18T00:00:00.000Z",
      });
      return id;
    });

    const auth = new LegacyFixtureAuthContext(organizationId);
    const hints = {headers: {"x-user-id": USER_ID}};
    const service = createProjectService({
      auth,
      repo: store.projectRepo,
      snapshots: createFsSnapshotStore(paths.snapshotDir),
      now: () => NOW,
      idFactory: () => SNAPSHOT_ID,
    });

    await service.createProject(hints, {
      projectId: PROJECT_ID,
      title: "Legacy Rich Fixture",
    });
    await service.saveDocument(hints, {
      projectId: PROJECT_ID,
      baseRevision: 0,
      transactionId: "tx-legacy-rich",
      schemaVersion: 1,
      document: richFixtureDocument(),
    });
    await service.createSnapshot(hints, {projectId: PROJECT_ID});
  } finally {
    store.close();
  }

  return readLegacyR1Manifest(paths.dbPath, paths.snapshotDir);
}

export {readLegacyR1Manifest, sha256File} from "./legacy-r1-manifest.js";
export type {LegacyR1Manifest} from "./legacy-r1-manifest.js";
