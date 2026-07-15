import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { StubAuthContext } from "@blocksync/auth-context";
import {
  verifyGoogleIdToken,
  type VerifyGoogleIdTokenOptions,
} from "@blocksync/google-identity";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteStore } from "@blocksync/project-store-sqlite";
import {
  createSessionService,
  SessionAuthContext,
} from "@blocksync/session-service";
import { assertAuthBootConfig } from "./auth-config.js";
import { SESSION_MAX_AGE_SEC } from "./cookies.js";
import { createPersistApp } from "./server.js";

export interface BootstrapOptions {
  env?: NodeJS.ProcessEnv;
  /** Test injection for Google ID token verification. */
  verifyGoogleIdToken?: (
    token: string,
    options: VerifyGoogleIdTokenOptions,
  ) => ReturnType<typeof verifyGoogleIdToken>;
}

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function bootstrapPersistRuntime(
  dataDir: string,
  options: BootstrapOptions = {},
) {
  const env = options.env ?? process.env;
  const config = assertAuthBootConfig(env);

  mkdirSync(dataDir, { recursive: true });
  const snapDir = join(dataDir, "snapshots");
  const store = openSqliteStore({
    dbPath: join(dataDir, "projects.sqlite"),
  });
  const repo = store.projectRepo;
  const snapshots = createFsSnapshotStore(snapDir);
  const removed = snapshots.gcOrphans(repo.listAllSnapshotStorageKeys());
  if (removed > 0) {
    console.log(`snapshot orphan GC removed ${removed} file(s)`);
  }

  if (config.mode === "google") {
    const parties = config.googleAuthorizedParties;
    if (parties.length === 0) {
      console.warn(
        "R1_GOOGLE_AUTHORIZED_PARTIES unset — azp will not be enforced",
      );
    }
    const sessionService = createSessionService({
      authRepo: store.authRepo,
      verifyGoogleIdToken: options.verifyGoogleIdToken ?? verifyGoogleIdToken,
      googleAudience: config.googleClientId!,
      authorizedParties: parties.length ? parties : undefined,
      allowedHostedDomains: config.allowedHostedDomains,
      sessionTtlSec: SESSION_MAX_AGE_SEC,
      now: () => new Date(),
      randomToken,
      hash: sha256Hex,
    });
    const auth = new SessionAuthContext({
      authRepo: store.authRepo,
      hash: sha256Hex,
      now: () => new Date(),
    });
    const service = createProjectService({
      auth,
      repo,
      snapshots,
    });
    const app = createPersistApp({
      auth,
      service,
      authMode: "google",
      allowedOrigins: config.allowedOrigins,
      cookieSecure: config.cookieSecure,
      sessionService,
      authRepo: store.authRepo,
      hash: sha256Hex,
      sessionMaxAgeSec: SESSION_MAX_AGE_SEC,
    });
    return {
      app,
      repo,
      authRepo: store.authRepo,
      authMode: "google" as const,
      close: () => store.close(),
      snapshots,
      service,
      sessionService,
    };
  }

  const auth = new StubAuthContext();
  const service = createProjectService({
    auth,
    repo,
    snapshots,
  });
  const app = createPersistApp({
    auth,
    service,
    authMode: "stub",
    allowedOrigins: config.allowedOrigins,
    cookieSecure: config.cookieSecure,
  });
  return {
    app,
    repo,
    authRepo: store.authRepo,
    authMode: "stub" as const,
    close: () => store.close(),
    snapshots,
    service,
  };
}
