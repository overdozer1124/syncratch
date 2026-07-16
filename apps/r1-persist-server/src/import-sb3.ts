import { randomUUID } from "node:crypto";
import type { AuthContext } from "@blocksync/auth-context";
import { contentHash, type ProjectEnvelopeV1 } from "@blocksync/project-envelope";
import {
  BadRequestError,
  ImportPreconditionError,
  UnauthorizedError,
  type AuthHints,
  type ImportAssetObjectInput,
  type ProjectService,
} from "@blocksync/project-service";
import type { AssetFsStore } from "@blocksync/project-assets-fs";
import { PathSafetyError } from "@blocksync/project-assets-fs";
import {
  GlobalDiskExceededError,
  OrgQuotaExceededError,
  ReservationCapacityExceededError,
  ReservationNotFoundError,
  StaleFileBytesError,
  GLOBAL_DISK_BYTES,
  IMPORT_SPOOL_CAP_BYTES,
  IMPORT_HOLDING_BUDGET_BYTES,
  INITIAL_GLOBAL_RESERVATION_BYTES,
  type AssetRepository,
} from "@blocksync/project-store-sqlite";
import {
  loadSb3Isolated,
  type LoadSb3IsolatedOptions,
  type Sb3ImportManifestAsset,
} from "@blocksync/sb3-tools";
import type { R1DataLayout } from "./data-dir.js";
import {
  cleanupImportSessionPaths,
  measureDataDirFileBytes,
  prepareSessionDirs,
  readHoldingAssetNoFollow,
  sessionSpoolPath,
  streamToSpoolNoFollow,
} from "./data-dir.js";
import { streamMultipartSb3File } from "./stream-multipart.js";
import { MAX_TITLE_LENGTH } from "./limits.js";

export interface ImportSb3OrchestratorDeps {
  auth: AuthContext;
  assetRepo: AssetRepository;
  assetFs: AssetFsStore;
  dataLayout: R1DataLayout;
  service: ProjectService;
  idFactory?: () => string;
  now?: () => Date;
  isolatedOptions?: LoadSb3IsolatedOptions;
}

async function resolvePrincipal(
  auth: AuthContext,
  hints: AuthHints,
) {
  try {
    return await auth.resolve(hints);
  } catch {
    throw new UnauthorizedError();
  }
}

function manifestToAssetObjects(
  assets: Sb3ImportManifestAsset[],
): ImportAssetObjectInput[] {
  return assets.map((asset) => ({
    sha256: asset.sha256,
    byteLength: asset.byteLength,
    md5Hex: asset.md5Hex,
    dataFormat: asset.dataFormat,
  }));
}

function maybeTestImportFail(stage: string): void {
  if (
    process.env.GATE0_TEST_HOOKS === "1" &&
    process.env.GATE0_IMPORT_FAIL_STAGE === stage
  ) {
    throw new ImportPreconditionError(`TEST_FAIL:${stage}`);
  }
}

export async function importSb3FromHttpRequest(
  deps: ImportSb3OrchestratorDeps,
  hints: AuthHints,
  req: Request,
): Promise<ProjectEnvelopeV1> {
  const importSessionId = randomUUID();
  const reservationId = randomUUID();
  const quotaReservationId = randomUUID();
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? randomUUID;
  let sessionActive = false;

  const principal = await resolvePrincipal(deps.auth, hints);
  const organizationId = principal.organizationId;

  const fileBytesBefore = measureDataDirFileBytes(deps.dataLayout);
  deps.assetRepo.createGlobalDiskReservation({
    reservationId,
    importSessionId,
    reservedBytes: INITIAL_GLOBAL_RESERVATION_BYTES,
    fileBytes: fileBytesBefore,
    now: now().toISOString(),
  });
  sessionActive = true;

  let title = "";
  let spoolBytes = 0;

  try {
    const parsed = await streamMultipartSb3File(
      req,
      IMPORT_SPOOL_CAP_BYTES,
      async (fileStream) => {
        spoolBytes = await streamToSpoolNoFollow(
          deps.dataLayout,
          importSessionId,
          fileStream,
          IMPORT_SPOOL_CAP_BYTES,
        );
        return spoolBytes;
      },
    );
    title = parsed.title?.trim() ? parsed.title.trim() : "Imported SB3";
    if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
      throw new BadRequestError(
        title.length === 0 ? "title required" : `title exceeds ${MAX_TITLE_LENGTH} characters`,
      );
    }

    deps.assetRepo.materializeGlobalDiskReservation({
      importSessionId,
      deltaBytes: spoolBytes,
      now: now().toISOString(),
    });

    const { holdingDir, workerTempDir } = prepareSessionDirs(
      deps.dataLayout,
      importSessionId,
    );
    const spoolPath = sessionSpoolPath(deps.dataLayout, importSessionId);

    const isolated = await loadSb3Isolated(
      new Uint8Array(0),
      { maxBytes: IMPORT_SPOOL_CAP_BYTES },
      {
        ...deps.isolatedOptions,
        spoolPath,
        holdingDir,
        workerTempDir,
        dataRootReal: deps.dataLayout.rootReal,
        holdingBudgetBytes: IMPORT_HOLDING_BUDGET_BYTES,
      },
    );

    if (isolated.timedOut || !isolated.ok || !isolated.document || !isolated.manifest) {
      const detail =
        isolated.issues[0]?.message ??
        (isolated.timedOut ? "worker timed out" : "SB3 load failed");
      throw new BadRequestError(detail);
    }

    const holdingBytesWritten = isolated.manifest.holdingBytesWritten ?? 0;
    if (holdingBytesWritten > 0) {
      deps.assetRepo.materializeGlobalDiskReservation({
        importSessionId,
        deltaBytes: holdingBytesWritten,
        now: now().toISOString(),
      });
    }

    const fileBytesAfterWorker = measureDataDirFileBytes(deps.dataLayout);
    if (
      deps.assetRepo.computeGlobalUsedBytes(
        fileBytesAfterWorker,
        now().toISOString(),
      ) > GLOBAL_DISK_BYTES
    ) {
      throw new GlobalDiskExceededError();
    }

    const document = isolated.document;
    const assetObjects = manifestToAssetObjects(isolated.manifest.assets);

    let newCasBytes = 0;
    for (const object of assetObjects) {
      if (!deps.assetFs.liveExists(object.sha256)) {
        newCasBytes += object.byteLength;
      }
    }

    if (newCasBytes > 0) {
      deps.assetRepo.extendGlobalDiskReservation({
        importSessionId,
        additionalBytes: newCasBytes,
        fileBytes: measureDataDirFileBytes(deps.dataLayout),
        now: now().toISOString(),
      });
    }

    deps.assetRepo.createImportLeases({
      organizationId,
      importSessionId,
      leases: assetObjects.map((object, index) => ({
        leaseId: `${importSessionId}-${index}`,
        sha256: object.sha256,
      })),
      now: now().toISOString(),
    });

    deps.assetRepo.createQuotaReservation({
      reservationId: quotaReservationId,
      organizationId,
      importSessionId,
      shas: assetObjects.map((object) => ({
        sha256: object.sha256,
        byteLength: object.byteLength,
      })),
      now: now().toISOString(),
    });
    maybeTestImportFail("after-quota");

    for (const object of assetObjects) {
      const bytes = readHoldingAssetNoFollow(
        deps.dataLayout,
        holdingDir,
        object.sha256,
        object.byteLength,
      );
      const result = deps.assetFs.putIfAbsent(object.sha256, bytes);
      if (result.wrote) {
        deps.assetRepo.materializeGlobalDiskReservation({
          importSessionId,
          deltaBytes: bytes.byteLength,
          now: now().toISOString(),
        });
      }
    }
    maybeTestImportFail("after-cas");

    const projectId = idFactory();
    const envelope: ProjectEnvelopeV1 = {
      format: "blocksync.project/v1",
      projectId,
      organizationId,
      title,
      revision: 0,
      schemaVersion: document.schemaVersion,
      contentHash: contentHash(document),
      updatedAt: now().toISOString(),
      updatedByUserId: principal.userId,
      document,
    };

    const finalFileBytes = measureDataDirFileBytes(deps.dataLayout);
    const result = await deps.service.importSb3Project(hints, {
      title,
      projectId,
      envelope,
      assetObjects,
      releaseImportSessionId: importSessionId,
      fileBytes: finalFileBytes,
    });
    sessionActive = false;
    return result;
  } catch (err) {
    if (
      err instanceof GlobalDiskExceededError ||
      err instanceof OrgQuotaExceededError ||
      err instanceof ReservationCapacityExceededError ||
      err instanceof ReservationNotFoundError ||
      err instanceof StaleFileBytesError ||
      err instanceof ImportPreconditionError
    ) {
      throw err;
    }
    if (err instanceof RangeError && String(err.message).includes("SPOOL_CAP")) {
      throw new BadRequestError(
        `SB3 upload exceeds ${IMPORT_SPOOL_CAP_BYTES} bytes`,
      );
    }
    if (err instanceof PathSafetyError) {
      throw new BadRequestError(err.message);
    }
    throw err;
  } finally {
    cleanupImportSessionPaths(deps.dataLayout, importSessionId);
    if (sessionActive) {
      try {
        deps.assetRepo.releaseImportSession({
          organizationId,
          importSessionId,
          now: now().toISOString(),
        });
      } catch {
        /* ignore */
      }
    }
  }
}

export {
  GlobalDiskExceededError,
  OrgQuotaExceededError,
  ReservationCapacityExceededError,
  ReservationNotFoundError,
  StaleFileBytesError,
};
