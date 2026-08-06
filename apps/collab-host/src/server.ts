/**
 * Same-origin collab host for Railway verification:
 * - GET /*  → apps/editor-web/dist static files
 * - POST /ai/chat → optional AI advice proxy (API key from client Authorization)
 * - /oauth/google/* → Drive authorization-code + refresh-token sessions
 * - /api/admin/* → classroom admin auth + policy/link CRUD (allowlist)
 * - /api/student/grant → exchange link token for HttpOnly grant cookie
 * - /api/student/policy → policy resolve via grant (re-validates link each time)
 * - /api/student/policy-by-token/* → legacy token resolve (pre-exchange)
 * - GET /ice → ephemeral Open Relay TURN credentials (HMAC static-auth)
 * - WS /signal → @blocksync/collab-signaling
 *
 * This process does not relay project bytes (WebRTC data channels are P2P/TURN).
 * AI proxy never stores API keys and never touches Yjs / signaling traffic.
 * Drive refresh tokens stay server-side (HttpOnly session cookie).
 * Admin sessions use a separate cookie from Drive OAuth.
 */
import {createServer} from "node:http";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  DEFAULT_SIGNALING_PATH,
  startSignalingServer,
} from "@blocksync/collab-signaling";
import {createAdminApiHandler} from "./admin-api.js";
import {
  createAdminAuthHandler,
  createMemoryAdminSessionStore,
  readAdminAuthConfigFromEnv,
  type AdminAuthConfig,
  type AdminSessionStore,
} from "./admin-auth.js";
import {
  defaultAdminDbPath,
  openAdminDb,
  type AdminDb,
} from "./admin-db.js";
import {handleAiChatProxy} from "./ai-proxy.js";
import {
  createDriveOAuthHandler,
  readDriveOAuthConfigFromEnv,
} from "./drive-oauth.js";
import {handleIceCredentials} from "./ice-endpoint.js";
import {createStaticRequestHandler} from "./static.js";
import {
  getClassroomFeatureFlagsForRuntime,
  resolveClassroomFeatureFlagsForStartup,
} from "./classroom-feature-flags-runtime.js";
import {
  createAdminGoogleOAuthHandler,
  parseAdminGoogleCryptoKeysFromEnv,
  readAdminGoogleOAuthConfigFromEnv,
} from "./admin-google-oauth.js";
import {createAdminGoogleCredentialStore} from "./admin-google-credential-store.js";
import {createRosterRoutesHandler} from "./roster-routes.js";
import {createStudentAuthRoutesHandler} from "./student-auth-routes.js";
import {
  createStudentGoogleOAuthHandler,
  readStudentGoogleOAuthConfigFromEnv,
} from "./student-google-oauth.js";
import {createSubmissionRoutesHandler} from "./submission-routes.js";

export interface StartCollabHostAdminOptions {
  db?: AdminDb;
  config?: AdminAuthConfig | null;
  sessions?: AdminSessionStore;
  /** Override startup-bound classroom flags (tests). */
  classroomFlags?: {
    classroomRosterEnabled: boolean;
    adminGoogleCredentialEnabled: boolean;
    rosterSheetsEnabled?: boolean;
    studentLocalAuthEnabled?: boolean;
    rosterGoogleStudentAuthEnabled?: boolean;
    teacherDriveSubmissionEnabled?: boolean;
    submissionPreviewEnabled?: boolean;
  };
  adminGoogleOAuthEnabled?: boolean;
  classroomRosterEnabled?: boolean;
  rosterSheetsEnabled?: boolean;
  studentLocalAuthEnabled?: boolean;
  rosterGoogleStudentAuthEnabled?: boolean;
  teacherDriveSubmissionEnabled?: boolean;
  submissionPreviewEnabled?: boolean;
}

export interface StartCollabHostOptions {
  port?: number;
  host?: string;
  staticRoot?: string;
  signalingPath?: string;
  /** Optional classroom admin layer (tests inject db/config/sessions). */
  admin?: StartCollabHostAdminOptions;
}

export interface CollabHostHandle {
  port: number;
  url: string;
  signalingUrl: string;
  close: () => Promise<void>;
}

function defaultStaticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // apps/collab-host/src → ../../editor-web/dist
  return resolve(here, "../../editor-web/dist");
}

function isAdminSubmissionPreviewSurfacePath(urlPath: string): boolean {
  const path = urlPath.split("?")[0] ?? "";
  return /^\/admin\/submissions\/[^/]+\/preview$/.test(path);
}

export async function startCollabHost(
  options: StartCollabHostOptions = {},
): Promise<CollabHostHandle> {
  resolveClassroomFeatureFlagsForStartup(process.env);
  const runtimeClassroomFlags =
    options.admin?.classroomFlags ?? getClassroomFeatureFlagsForRuntime();
  const adminGoogleOAuthEnabled =
    options.admin?.adminGoogleOAuthEnabled ??
    (runtimeClassroomFlags.classroomRosterEnabled &&
      runtimeClassroomFlags.adminGoogleCredentialEnabled);
  const classroomRosterEnabled =
    options.admin?.classroomRosterEnabled ??
    runtimeClassroomFlags.classroomRosterEnabled;
  const rosterSheetsEnabled = Boolean(
    options.admin?.rosterSheetsEnabled ??
      options.admin?.classroomFlags?.rosterSheetsEnabled ??
      (runtimeClassroomFlags.classroomRosterEnabled &&
        runtimeClassroomFlags.adminGoogleCredentialEnabled &&
        runtimeClassroomFlags.rosterSheetsEnabled),
  );
  const studentLocalAuthEnabled = Boolean(
    options.admin?.studentLocalAuthEnabled ??
      options.admin?.classroomFlags?.studentLocalAuthEnabled ??
      (runtimeClassroomFlags.classroomRosterEnabled &&
        runtimeClassroomFlags.studentLocalAuthEnabled),
  );
  const rosterGoogleStudentAuthEnabled = Boolean(
    options.admin?.rosterGoogleStudentAuthEnabled ??
      options.admin?.classroomFlags?.rosterGoogleStudentAuthEnabled ??
      (runtimeClassroomFlags.classroomRosterEnabled &&
        runtimeClassroomFlags.studentLocalAuthEnabled &&
        runtimeClassroomFlags.rosterGoogleStudentAuthEnabled),
  );
  const teacherDriveSubmissionEnabled = Boolean(
    options.admin?.teacherDriveSubmissionEnabled ??
      options.admin?.classroomFlags?.teacherDriveSubmissionEnabled ??
      (runtimeClassroomFlags.classroomRosterEnabled &&
        runtimeClassroomFlags.studentLocalAuthEnabled &&
        runtimeClassroomFlags.teacherDriveSubmissionEnabled),
  );
  const submissionPreviewEnabled = Boolean(
    options.admin?.submissionPreviewEnabled ??
      options.admin?.classroomFlags?.submissionPreviewEnabled ??
      (teacherDriveSubmissionEnabled &&
        runtimeClassroomFlags.submissionPreviewEnabled),
  );
  const adminGoogleOAuthConfig = readAdminGoogleOAuthConfigFromEnv();

  const port = options.port ?? Number(process.env.PORT ?? 8080);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const staticRoot =
    options.staticRoot ?? process.env.STATIC_ROOT ?? defaultStaticRoot();
  const signalingPath =
    options.signalingPath?.trim() ||
    process.env.SIGNALING_PATH?.trim() ||
    DEFAULT_SIGNALING_PATH;

  const handleStatic = createStaticRequestHandler(staticRoot);
  const handleDriveOAuth = createDriveOAuthHandler({
    config: readDriveOAuthConfigFromEnv(),
  });
  const adminDb =
    options.admin?.db ??
    openAdminDb(
      process.env.ADMIN_DB_PATH?.trim() ||
        (process.env.VITEST === "true" ? ":memory:" : defaultAdminDbPath()),
    );
  const adminConfig =
    options.admin?.config !== undefined
      ? options.admin.config
      : readAdminAuthConfigFromEnv();
  const adminSessions =
    options.admin?.sessions ?? createMemoryAdminSessionStore();
  const handleAdminAuth = createAdminAuthHandler({
    db: adminDb,
    config: adminConfig,
    sessions: adminSessions,
  });
  const handleAdminApi = createAdminApiHandler({
    db: adminDb,
    config: adminConfig,
    sessions: adminSessions,
    classroomRosterEnabled,
    adminGoogleCredentialEnabled: adminGoogleOAuthEnabled,
    rosterSheetsEnabled,
    studentLocalAuthEnabled,
    rosterGoogleStudentAuthEnabled,
    teacherDriveSubmissionEnabled,
    submissionPreviewEnabled,
  });
  const adminGoogleCryptoKeys = parseAdminGoogleCryptoKeysFromEnv();
  const adminGoogleCredentialStore =
    adminGoogleCryptoKeys != null
      ? createAdminGoogleCredentialStore(adminDb.sqlite, adminGoogleCryptoKeys)
      : null;
  const handleAdminGoogleOAuth = createAdminGoogleOAuthHandler({
    enabled: adminGoogleOAuthEnabled,
    db: adminDb.sqlite,
    adminConfig,
    adminSessions,
    oauthConfig: adminGoogleOAuthConfig,
    cryptoKeys: adminGoogleCryptoKeys,
    store: adminGoogleCredentialStore ?? undefined,
  });
  const rosterSheetSync =
    rosterSheetsEnabled &&
    adminGoogleOAuthConfig &&
    adminGoogleCredentialStore
      ? {
          oauthConfig: adminGoogleOAuthConfig,
          credentialStore: adminGoogleCredentialStore,
        }
      : null;
  const handleRosterRoutes = createRosterRoutesHandler({
    enabled: classroomRosterEnabled,
    sheetsEnabled: rosterSheetsEnabled,
    db: adminDb.sqlite,
    adminConfig,
    adminSessions,
    sheetSync: rosterSheetSync,
  });
  const studentGoogleOAuthConfig = readStudentGoogleOAuthConfigFromEnv();
  const handleStudentAuthRoutes = createStudentAuthRoutesHandler({
    enabled: studentLocalAuthEnabled,
    db: adminDb.sqlite,
    adminConfig,
    adminSessions,
    cookieSecure:
      adminConfig?.cookieSecure ?? process.env.NODE_ENV === "production",
  });
  const handleStudentGoogleOAuth = createStudentGoogleOAuthHandler({
    enabled: rosterGoogleStudentAuthEnabled,
    db: adminDb.sqlite,
    oauthConfig: studentGoogleOAuthConfig,
    cookieSecure:
      adminConfig?.cookieSecure ?? process.env.NODE_ENV === "production",
  });
  const submissionDriveEnv =
    teacherDriveSubmissionEnabled &&
    adminGoogleOAuthConfig &&
    adminGoogleCredentialStore
      ? {
          oauthConfig: adminGoogleOAuthConfig,
          credentialStore: adminGoogleCredentialStore,
        }
      : null;
  const handleSubmissionRoutes = createSubmissionRoutesHandler({
    enabled: teacherDriveSubmissionEnabled,
    db: adminDb.sqlite,
    adminConfig,
    adminSessions,
    driveEnv: submissionDriveEnv,
  });
  const httpServer = createServer((req, res) => {
    void (async () => {
      if (await handleDriveOAuth(req, res)) return;
      if (await handleAdminGoogleOAuth(req, res)) return;
      if (await handleRosterRoutes(req, res)) return;
      if (await handleStudentGoogleOAuth(req, res)) return;
      if (await handleStudentAuthRoutes(req, res)) return;
      if (await handleSubmissionRoutes(req, res)) return;
      if (await handleAdminAuth(req, res)) return;
      if (await handleAdminApi(req, res)) return;
      if (await handleAiChatProxy(req, res)) return;
      if (await handleIceCredentials(req, res)) return;
      if (
        req.method === "GET" &&
        isAdminSubmissionPreviewSurfacePath(req.url ?? "/") &&
        !submissionPreviewEnabled
      ) {
        res.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
        res.end("not found");
        return;
      }
      if (handleStatic(req, res)) return;
      res.writeHead(405, {"content-type": "text/plain; charset=utf-8"});
      res.end("method not allowed");
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, {"content-type": "text/plain; charset=utf-8"});
      }
      res.end("internal error");
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolveListen());
  });

  const signaling = await startSignalingServer({
    httpServer,
    path: signalingPath,
    host: "127.0.0.1",
  });

  const address = httpServer.address();
  const resolvedPort =
    typeof address === "object" && address ? address.port : port;
  const publicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

  return {
    port: resolvedPort,
    url: `http://${publicHost}:${resolvedPort}/`,
    signalingUrl: signaling.url,
    close: async () => {
      await signaling.close();
      adminDb.close();
      await new Promise<void>((resolveClose, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolveClose()));
      });
    },
  };
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  const handle = await startCollabHost();
  console.log(`[collab-host] static+signaling listening on ${handle.url}`);
  console.log(`[collab-host] signaling websocket ${handle.signalingUrl}`);
}
