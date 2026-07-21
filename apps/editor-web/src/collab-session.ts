/**
 * Editor collaboration orchestration with Drive-independent bootstrap.
 *
 * The room-creating device seals an in-band checkpoint before connecting.
 * Guests receive into a staging Y.Doc, validate the latest seal, then create a
 * new local project copy. Drive writes are authorized only by the local
 * creator capability — never by peer eligibility or leader election.
 */
import * as Y from "yjs";
import {
  COLLAB_FALLBACK_TITLE,
  encodeStateVectorBase64,
  LOCAL_ORIGIN,
  newBootstrapId,
  normalizeProjectTitle,
  ProjectCollaborationDocument,
  readBootstrapCheckpoint,
  runHostPreflight,
  summarizePreflightIssues,
  validateSealedCheckpoint,
  writeBootstrapSealed,
  writeBootstrapSeeding,
  type HostPreflightResult,
} from "@blocksync/collaboration-domain";
import type {CollabProvider} from "@blocksync/collab-webrtc";
import {electLeader, isLeader as leaderMatches, type LeadershipState} from "@blocksync/collab-leader";
import type {ProjectDocument} from "@blocksync/project-schema";

export interface CollabReadinessInput {
  signalingUrl: string;
}

export type CollabReadiness = {ok: true} | {ok: false; reason: string};

/** Create/join require only a configured signaling URL. */
export function evaluateCollabReadiness(input: CollabReadinessInput): CollabReadiness {
  if (!input.signalingUrl || input.signalingUrl.trim().length === 0) {
    return {ok: false, reason: "Collaboration signaling is not configured"};
  }
  return {ok: true};
}

export type CollabRole = "solo" | "leader" | "follower";

export type BootstrapPhase =
  | "idle"
  | "receiving-project"
  | "verifying-project"
  | "saving-local-copy"
  | "ready"
  | "stalled-project"
  | "invalid-project"
  | "local-save-failed";

export interface CollabState {
  status: string;
  peerCount: number;
  role: CollabRole;
  epoch: string | null;
  conflict: boolean;
  bootstrapPhase: BootstrapPhase;
  createdThisRoom: boolean;
  verifiedAssets: number;
  expectedAssets: number;
  receivedBytes: number;
  issueCodes: string[];
  signalingPeerCount: number;
  joinedTopic: boolean;
}

export interface LocalMaterialization {
  document: ProjectDocument;
  assets: Map<string, Uint8Array>;
}

export type ApplyRemoteMode = "guest-initial" | "update";

export interface ApplyRemoteContext {
  mode: ApplyRemoteMode;
  projectTitle?: string;
}

export interface CollabProviderConfig {
  doc: Y.Doc;
  secret: string;
  participantId: string;
  applyRemoteUpdate: (update: Uint8Array) => boolean;
  isLocalOrigin: (origin: unknown) => boolean;
}

export interface CollabSessionOptions {
  roomId: string;
  secret: string;
  participantId: string;
  createProvider: (config: CollabProviderConfig) => CollabProvider;
  materializeLocal: () => LocalMaterialization;
  applyRemoteToLocal: (
    document: ProjectDocument,
    assets: Map<string, Uint8Array>,
    context: ApplyRemoteContext,
  ) => void | boolean | Promise<void | boolean>;
  /**
   * Restore the pre-guest-initial local project when bootstrap cannot reach
   * ready after a tentative guest-initial apply (awaiting / invalid / leave).
   */
  rollbackGuestInitialLocal?: () => void | boolean | Promise<void | boolean>;
  /** Kept for diagnostics/compat; never authorizes Drive writes. */
  eligible?: boolean;
  reobserveDriveBeforeLeadership?: () => void | Promise<void>;
  debounceMs?: number;
  stallInactivityMs?: number;
  projectTitle?: () => string;
  onState?: (state: CollabState) => void;
  /** Optional injection for deterministic bootstrap ids in tests. */
  randomBootstrapId?: () => string;
}

export interface BootstrapDiagnostics {
  phase: BootstrapPhase;
  issueCodes: string[];
  verifiedAssets: number;
  expectedAssets: number;
  receivedBytes: number;
  peerCount: number;
  createdThisRoom: boolean;
  status: string;
  sawPeerDuringBootstrap: boolean;
  signalingPeerCount: number;
  sawSignalingPeer: boolean;
  joinedTopic: boolean;
  signalingError: string | null;
}

export interface CollabSession {
  start(options: {host: boolean}): HostPreflightResult | {ok: true};
  leave(): void;
  noteLocalChange(): void;
  reportDriveConflict(): void;
  clearDriveConflict(): void;
  canPersistToDrive(options?: {explicit?: boolean}): {ok: boolean; reason?: string};
  leadershipEpoch(): string;
  isLeader(): boolean;
  createdThisRoom(): boolean;
  getBootstrapPhase(): BootstrapPhase;
  getState(): CollabState;
  flush(): Promise<void>;
  retryLocalSave(): Promise<void>;
  reconnectBootstrap(): void;
  getDiagnostics(): BootstrapDiagnostics;
  getValidatedMaterialization(): LocalMaterialization | null;
  readonly domain: ProjectCollaborationDocument;
  readonly provider: CollabProvider;
}

const DEFAULT_STALL_MS = 15_000;
/** Extra wait while signaling sees a peer but the data channel is still negotiating. */
const ICE_NEGOTIATION_STALL_MS = 45_000;
/** Bounded signaling reconnects for hosts waiting on guests and guests bootstrapping. */
const MAX_SIGNALING_AUTO_RECONNECTS = 5;

export function createCollabSession(options: CollabSessionOptions): CollabSession {
  const domain = new ProjectCollaborationDocument();
  const selfEligible = options.eligible ?? true;
  const debounceMs = options.debounceMs ?? 250;
  const stallInactivityMs = options.stallInactivityMs ?? DEFAULT_STALL_MS;

  let bootstrapPhase: BootstrapPhase = "idle";
  let createdThisRoom = false;
  let guestReady = false;
  let verifiedAssets = 0;
  let expectedAssets = 0;
  let receivedBytes = 0;
  let issueCodes: string[] = [];
  let lastProgressAt = 0;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let sawPeerDuringBootstrap = false;
  let sawSignalingPeer = false;
  let ignoreEmptyPeerStall = false;
  let signalingAutoReconnects = 0;
  let validatedMaterialization: LocalMaterialization | null = null;
  let validatedTitle = COLLAB_FALLBACK_TITLE;
  let sealGeneration = 0;
  let sealTimer: ReturnType<typeof setTimeout> | null = null;
  let lastBootstrapId: string | null = null;
  let active = false;
  let guestApplyInFlight = false;
  let stagingChangedDuringGuestApply = false;
  let guestInitialCopyApplied = false;
  const isInvalidProject = (): boolean =>
    bootstrapPhase === "invalid-project";

  const applyRemoteUpdate = (update: Uint8Array): boolean => {
    if (!active || isInvalidProject()) return false;
    receivedBytes += update.byteLength;
    markProgress("bytes");
    if (!createdThisRoom && !guestReady) {
      const result = domain.tryApplyStagingUpdate(update);
      if (!result.accepted) {
        enterInvalid(result.issues?.map(item => String(item.code)) ?? ["INVALID_DOCUMENT"]);
        return false;
      }
      scheduleGuestEvaluate();
      return true;
    }
    const result = domain.tryApplyRemoteUpdate(update);
    if (!result.accepted) {
      // After ready: keep last valid VM / revision (do not apply).
      issueCodes = result.issues?.map(item => String(item.code)) ?? ["INVALID_DOCUMENT"];
      emitState();
      return false;
    }
    return true;
  };

  const provider = options.createProvider({
    doc: domain.ydoc,
    secret: options.secret,
    participantId: options.participantId,
    applyRemoteUpdate,
    isLocalOrigin: (origin) => origin === LOCAL_ORIGIN,
  });

  let conflict = false;
  let suppressLocal = false;
  let leadership: LeadershipState | null = null;
  let leadershipReady = true;
  let leadershipGeneration = 0;
  let wasLeader = false;
  let seenAsFollower = false;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let applyPending: Promise<void> = Promise.resolve();
  let maySeed = false;
  let guestEvaluateTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingTargets = new Map<string, ProjectDocument["targets"][number]>();
  const pendingTargetDeletions = new Set<string>();
  const pendingAssets = new Map<string, Uint8Array>();
  const lastLocalTargetJson = new Map(
    options.materializeLocal().document.targets.map(
      target => [target.id, JSON.stringify(target)] as const,
    ),
  );

  const isSeeded = (): boolean => domain.ydoc.getMap("targets").size > 0;

  const currentTargetJson = (id: string): unknown => {
    const entry = domain.ydoc.getMap<Y.Map<unknown>>("targets").get(id);
    return entry instanceof Y.Map ? entry.get("json") : undefined;
  };

  const syncLocalToDoc = (): void => {
    if (suppressLocal) return;
    const {document, assets} = options.materializeLocal();
    if (!isSeeded()) {
      domain.loadLocalProject(document, assets);
      return;
    }
    for (const target of document.targets) {
      if (currentTargetJson(target.id) !== JSON.stringify(target)) {
        domain.setTarget(target);
      }
    }
    const assetMap = domain.ydoc.getMap<Uint8Array>("assets");
    for (const [md5ext, bytes] of assets) {
      if (!assetMap.has(md5ext)) domain.putAsset(md5ext, bytes);
    }
  };

  const capturePendingLocalChanges = (): void => {
    if (suppressLocal) return;
    const {document, assets} = options.materializeLocal();
    const currentIds = new Set(document.targets.map(target => target.id));
    for (const targetId of lastLocalTargetJson.keys()) {
      if (!currentIds.has(targetId)) {
        pendingTargets.delete(targetId);
        pendingTargetDeletions.add(targetId);
      }
    }
    for (const target of document.targets) {
      if (lastLocalTargetJson.get(target.id) !== JSON.stringify(target)) {
        pendingTargetDeletions.delete(target.id);
        pendingTargets.set(target.id, target);
      }
    }
    const sharedAssets = domain.ydoc.getMap<Uint8Array>("assets");
    for (const [md5ext, bytes] of assets) {
      if (!sharedAssets.has(md5ext)) pendingAssets.set(md5ext, bytes);
    }
  };

  const targetAssetIds = (
    target: ProjectDocument["targets"][number],
  ): string[] => [
    ...(target.costumes ?? []).map(costume => costume.md5ext),
    ...(target.sounds ?? []).map(sound => sound.md5ext),
  ];

  let assetRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let applyTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleAssetRetry = (): void => {
    if (assetRetryTimer) return;
    assetRetryTimer = setTimeout(() => {
      assetRetryTimer = null;
      capturePendingLocalChanges();
      pushPendingLocalChanges();
    }, 400);
  };

  const pushPendingLocalChanges = (): void => {
    if (suppressLocal) return;
    if (!createdThisRoom && !guestReady) return;
    const {assets} = options.materializeLocal();
    if (!isSeeded()) {
      if (!maySeed) return;
      const local = options.materializeLocal();
      const missing = local.document.targets.some(target =>
        targetAssetIds(target).some(md5ext => !local.assets.has(md5ext)),
      );
      if (missing) {
        scheduleAssetRetry();
        return;
      }
      syncLocalToDoc();
      scheduleRollingSeal();
      return;
    }
    for (const targetId of pendingTargetDeletions) {
      domain.deleteTarget(targetId);
      lastLocalTargetJson.delete(targetId);
    }
    pendingTargetDeletions.clear();

    for (const [md5ext, bytes] of pendingAssets) domain.putAsset(md5ext, bytes);
    pendingAssets.clear();
    const sharedAssets = domain.ydoc.getMap<Uint8Array>("assets");
    for (const [md5ext, bytes] of assets) {
      if (!sharedAssets.has(md5ext)) domain.putAsset(md5ext, bytes);
    }

    const deferred = new Map<string, ProjectDocument["targets"][number]>();
    for (const [targetId, target] of pendingTargets) {
      const needed = targetAssetIds(target);
      const ready = needed.every(
        md5ext => sharedAssets.has(md5ext) || assets.has(md5ext),
      );
      if (!ready) {
        deferred.set(targetId, target);
        continue;
      }
      for (const md5ext of needed) {
        const bytes = assets.get(md5ext);
        if (bytes && !sharedAssets.has(md5ext)) domain.putAsset(md5ext, bytes);
      }
      domain.setTarget(target);
      lastLocalTargetJson.set(targetId, JSON.stringify(target));
    }
    pendingTargets.clear();
    for (const [targetId, target] of deferred) {
      pendingTargets.set(targetId, target);
    }
    if (pendingTargets.size > 0) scheduleAssetRetry();
    if (createdThisRoom) scheduleRollingSeal();
  };

  const role = (): CollabRole => {
    if (!active) return "solo";
    return leaderMatches(leadership, options.participantId) ? "leader" : "follower";
  };

  const emitState = (): void => {
    options.onState?.({
      status: provider.getStatus(),
      peerCount: provider.getPeers().length,
      role: role(),
      epoch: leadership?.epoch ?? null,
      conflict,
      bootstrapPhase,
      createdThisRoom,
      verifiedAssets,
      expectedAssets,
      receivedBytes,
      issueCodes: [...issueCodes],
      signalingPeerCount: provider.getSignalingPeers().length,
      joinedTopic: provider.hasJoinedTopic(),
    });
  };

  const markProgress = (_kind: string): void => {
    lastProgressAt = Date.now();
    if (
      bootstrapPhase === "stalled-project" &&
      !createdThisRoom &&
      !guestReady
    ) {
      bootstrapPhase = "receiving-project";
    }
    armStallTimer();
  };

  const currentStallMs = (): number => {
    const negotiating =
      sawSignalingPeer && provider.getPeers().length === 0;
    return negotiating
      ? Math.max(stallInactivityMs, ICE_NEGOTIATION_STALL_MS)
      : stallInactivityMs;
  };

  const armStallTimer = (): void => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    if (
      createdThisRoom ||
      guestReady ||
      bootstrapPhase === "idle" ||
      bootstrapPhase === "ready" ||
      bootstrapPhase === "invalid-project" ||
      bootstrapPhase === "local-save-failed"
    ) {
      return;
    }
    const waitMs = currentStallMs();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (
        !createdThisRoom &&
        !guestReady &&
        bootstrapPhase !== "invalid-project" &&
        bootstrapPhase !== "ready" &&
        Date.now() - lastProgressAt >= currentStallMs()
      ) {
        bootstrapPhase = "stalled-project";
        emitState();
      }
    }, waitMs);
  };

  const enterInvalid = (codes: string[]): void => {
    bootstrapPhase = "invalid-project";
    issueCodes = codes;
    stagingChangedDuringGuestApply = false;
    domain.releaseStagingGuardResources();
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    emitState();
  };

  const performInitialHostSeal = (): HostPreflightResult => {
    const local = options.materializeLocal();
    const title = normalizeProjectTitle(options.projectTitle?.());
    const preflight = runHostPreflight(local.document, local.assets, {
      projectTitle: title,
    });
    if (!preflight.ok) {
      const summary = summarizePreflightIssues(preflight.issues);
      issueCodes = summary.codes;
      return preflight;
    }

    const bootstrapId = options.randomBootstrapId?.() ?? newBootstrapId();
    lastBootstrapId = bootstrapId;
    domain.loadLocalProject(local.document, local.assets);
    writeBootstrapSeeding(domain.ydoc, bootstrapId, LOCAL_ORIGIN);
    const contentStateVector = encodeStateVectorBase64(domain.ydoc);
    writeBootstrapSealed(domain.ydoc, {
      bootstrapId,
      projectTitle: preflight.projectTitle,
      contentStateVector,
      documentHash: preflight.documentHash,
      assetManifest: preflight.assetManifest,
    }, LOCAL_ORIGIN);
    expectedAssets = preflight.assetManifest.length;
    verifiedAssets = preflight.assetManifest.length;
    return {ok: true, documentHash: preflight.documentHash, assetManifest: preflight.assetManifest, projectTitle: preflight.projectTitle};
  };

  const scheduleRollingSeal = (): void => {
    if (!createdThisRoom || bootstrapPhase !== "ready") return;
    if (sealTimer) clearTimeout(sealTimer);
    const generation = ++sealGeneration;
    sealTimer = setTimeout(() => {
      sealTimer = null;
      void publishRollingSeal(generation);
    }, debounceMs);
  };

  const publishRollingSeal = async (generation: number): Promise<void> => {
    if (!createdThisRoom || generation !== sealGeneration) return;
    const bootstrapId = options.randomBootstrapId?.() ?? newBootstrapId();
    lastBootstrapId = bootstrapId;
    writeBootstrapSeeding(domain.ydoc, bootstrapId, LOCAL_ORIGIN);
    // Wait a tick so concurrent edits can supersede this generation.
    await Promise.resolve();
    if (generation !== sealGeneration) return;
    const materialized = domain.materialize();
    if (!materialized.ok) return;
    if (generation !== sealGeneration) return;
    const preflight = runHostPreflight(materialized.document, materialized.assets, {
      projectTitle: options.projectTitle?.(),
    });
    if (!preflight.ok) return;
    if (generation !== sealGeneration) return;
    const contentStateVector = encodeStateVectorBase64(domain.ydoc);
    writeBootstrapSealed(domain.ydoc, {
      bootstrapId,
      projectTitle: preflight.projectTitle,
      contentStateVector,
      documentHash: preflight.documentHash,
      assetManifest: preflight.assetManifest,
    }, LOCAL_ORIGIN);
    expectedAssets = preflight.assetManifest.length;
    verifiedAssets = preflight.assetManifest.length;
    emitState();
  };

  const scheduleGuestEvaluate = (): void => {
    if (guestEvaluateTimer) clearTimeout(guestEvaluateTimer);
    guestEvaluateTimer = setTimeout(() => {
      guestEvaluateTimer = null;
      void evaluateGuestBootstrap();
    }, Math.max(debounceMs, 20));
  };

  const validateCurrentGuestStaging = (): LocalMaterialization | null => {
    const checkpoint = readBootstrapCheckpoint(domain.ydoc);
    if (checkpoint?.assetManifest) {
      expectedAssets = checkpoint.assetManifest.length;
    }
    if (checkpoint?.state === "sealed") {
      markProgress("bootstrap");
    }

    if (
      bootstrapPhase !== "stalled-project" &&
      bootstrapPhase !== "saving-local-copy"
    ) {
      bootstrapPhase = "verifying-project";
    }

    const result = validateSealedCheckpoint(domain.ydoc, () => domain.materialize());
    verifiedAssets = result.verifiedAssetCount;
    expectedAssets = result.expectedAssetCount;

    if (result.status === "incomplete-vector" || result.status === "missing-assets") {
      if (bootstrapPhase !== "stalled-project") {
        bootstrapPhase = "receiving-project";
      }
      emitState();
      armStallTimer();
      return null;
    }

    if (result.status === "awaiting-newer-seal") {
      if (bootstrapPhase !== "stalled-project") {
        bootstrapPhase = "receiving-project";
      }
      markProgress("manifest");
      emitState();
      armStallTimer();
      return null;
    }

    if (result.status === "invalid") {
      enterInvalid(result.issues.map(item => item.code));
      return null;
    }

    if (!result.document || !result.assets) return null;
    validatedMaterialization = {
      document: result.document,
      assets: new Map(result.assets),
    };
    validatedTitle = normalizeProjectTitle(checkpoint?.projectTitle);
    return validatedMaterialization;
  };

  const rollbackTentativeGuestInitial = async (): Promise<void> => {
    if (!guestInitialCopyApplied || guestReady) return;
    guestInitialCopyApplied = false;
    if (!options.rollbackGuestInitialLocal) return;
    try {
      await options.rollbackGuestInitialLocal();
    } catch {
      // Rollback best-effort; phase handling belongs to the caller.
    }
    lastLocalTargetJson.clear();
    for (const target of options.materializeLocal().document.targets) {
      lastLocalTargetJson.set(target.id, JSON.stringify(target));
    }
  };

  const evaluateGuestBootstrap = async (): Promise<void> => {
    if (!active || createdThisRoom || guestReady || guestApplyInFlight) return;
    if (
      bootstrapPhase === "invalid-project" ||
      bootstrapPhase === "local-save-failed"
    ) {
      return;
    }

    let nextMaterialization = validateCurrentGuestStaging();
    if (!nextMaterialization) return;
    guestApplyInFlight = true;
    bootstrapPhase = "saving-local-copy";
    emitState();
    try {
      suppressLocal = true;
      while (nextMaterialization) {
        stagingChangedDuringGuestApply = false;
        const mode: ApplyRemoteMode = guestInitialCopyApplied
          ? "update"
          : "guest-initial";
        const applied = await options.applyRemoteToLocal(
          nextMaterialization.document,
          nextMaterialization.assets,
          mode === "guest-initial"
            ? {mode, projectTitle: validatedTitle}
            : {mode},
        );
        // false means the apply layer cancelled and already kept/restored previous.
        if (applied === false) return;
        if (mode === "guest-initial") {
          guestInitialCopyApplied = true;
        }

        if (!active || isInvalidProject()) {
          await rollbackTentativeGuestInitial();
          return;
        }

        guestInitialCopyApplied = true;
        lastLocalTargetJson.clear();
        for (const target of options.materializeLocal().document.targets) {
          lastLocalTargetJson.set(target.id, JSON.stringify(target));
        }

        if (!stagingChangedDuringGuestApply) {
          guestReady = true;
          bootstrapPhase = "ready";
          issueCodes = [];
          domain.releaseStagingGuardResources();
          if (stallTimer) {
            clearTimeout(stallTimer);
            stallTimer = null;
          }
          return;
        }

        nextMaterialization = validateCurrentGuestStaging();
        if (!nextMaterialization) {
          // awaiting / incomplete / invalid: keep previous local project.
          await rollbackTentativeGuestInitial();
          return;
        }
        bootstrapPhase = "saving-local-copy";
        emitState();
      }
    } catch {
      if (!active || isInvalidProject()) {
        await rollbackTentativeGuestInitial();
        return;
      }
      stagingChangedDuringGuestApply = false;
      bootstrapPhase = "local-save-failed";
      issueCodes = ["LOCAL_SAVE_FAILED"];
    } finally {
      suppressLocal = false;
      guestApplyInFlight = false;
      stagingChangedDuringGuestApply = false;
      if (active && !isInvalidProject()) emitState();
    }
  };

  const recomputeLeadership = (): void => {
    const participants = [{participantId: options.participantId, eligible: selfEligible}];
    for (const [peerId, state] of provider.getAwareness()) {
      participants.push({participantId: peerId, eligible: state.eligible !== false});
    }
    leadership = electLeader(options.roomId, participants);
    const nowLeader = leaderMatches(leadership, options.participantId);
    if (
      active &&
      nowLeader &&
      !wasLeader &&
      seenAsFollower &&
      options.reobserveDriveBeforeLeadership
    ) {
      leadershipReady = false;
      const generation = ++leadershipGeneration;
      Promise.resolve(options.reobserveDriveBeforeLeadership())
        .then(() => {
          if (generation === leadershipGeneration) leadershipReady = true;
        })
        .catch(() => {
          if (generation === leadershipGeneration) {
            conflict = true;
            leadershipReady = true;
          }
        })
        .finally(() => {
          if (generation === leadershipGeneration) emitState();
        });
    } else if (!nowLeader) {
      seenAsFollower = true;
      leadershipGeneration += 1;
      leadershipReady = true;
      if (conflict) conflict = false;
    }
    wasLeader = nowLeader;

    // Sealer disconnect while guest still bootstrapping → stalled.
    if (
      !createdThisRoom &&
      !guestReady &&
      active &&
      bootstrapPhase !== "invalid-project" &&
      bootstrapPhase !== "ready" &&
      bootstrapPhase !== "idle"
    ) {
      const sealerPresent = provider.getPeers().some(() => true) ||
        [...provider.getAwareness().keys()].length > 0;
      // If we had peers and now have none after previously seeing peers, stall.
      if (provider.getPeers().length === 0 && seenAsFollower === false) {
        // no-op; join race
      }
      void sealerPresent;
    }
    emitState();
  };

  const runApplyToLocal = (): void => {
    applyPending = applyPending
      .then(async () => {
        if (!createdThisRoom && !guestReady) {
          scheduleGuestEvaluate();
          return;
        }
        const result = domain.materialize();
        if (!result.ok) {
          issueCodes = result.issues.map(item => String(item.code));
          emitState();
          return;
        }
        suppressLocal = true;
        try {
          await options.applyRemoteToLocal(result.document, result.assets, {
            mode: "update",
          });
          lastLocalTargetJson.clear();
          for (const target of options.materializeLocal().document.targets) {
            lastLocalTargetJson.set(target.id, JSON.stringify(target));
          }
        } catch {
          // Preserve last valid VM / revision.
          issueCodes = ["REMOTE_APPLY_FAILED"];
        } finally {
          suppressLocal = false;
        }
      })
      .catch(() => undefined);
  };

  const scheduleApplyToLocal = (): void => {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      applyTimer = null;
      runApplyToLocal();
    }, Math.max(debounceMs, 100));
  };

  domain.onRemoteChange(() => {
    markProgress("peer");
    if (guestApplyInFlight && !createdThisRoom && !guestReady) {
      stagingChangedDuringGuestApply = true;
    }
    if (
      pendingTargets.size > 0 ||
      pendingTargetDeletions.size > 0 ||
      pendingAssets.size > 0
    ) {
      if (localTimer) {
        clearTimeout(localTimer);
        localTimer = null;
      }
      pushPendingLocalChanges();
    }
    if (!createdThisRoom && !guestReady) {
      scheduleGuestEvaluate();
    } else {
      scheduleApplyToLocal();
      if (createdThisRoom) scheduleRollingSeal();
    }
    emitState();
  });
  const forceTransportReconnect = (): void => {
    ignoreEmptyPeerStall = true;
    sawPeerDuringBootstrap = false;
    try {
      provider.disconnect();
      provider.connect();
    } finally {
      ignoreEmptyPeerStall = false;
    }
  };

  provider.on("status", () => {
    emitState();
    if (
      !active ||
      ignoreEmptyPeerStall ||
      provider.getStatus() !== "disconnected" ||
      bootstrapPhase === "invalid-project" ||
      bootstrapPhase === "idle" ||
      bootstrapPhase === "local-save-failed" ||
      signalingAutoReconnects >= MAX_SIGNALING_AUTO_RECONNECTS
    ) {
      return;
    }
    signalingAutoReconnects += 1;
    queueMicrotask(() => {
      if (!active || provider.getStatus() !== "disconnected") return;
      if (bootstrapPhase === "stalled-project") {
        bootstrapPhase = "receiving-project";
      }
      lastProgressAt = Date.now();
      if (!createdThisRoom && !guestReady) armStallTimer();
      forceTransportReconnect();
      if (!createdThisRoom && !guestReady) scheduleGuestEvaluate();
      emitState();
    });
  });
  provider.on("peers", () => {
    const peers = provider.getPeers();
    if (peers.length > 0) {
      sawPeerDuringBootstrap = true;
      signalingAutoReconnects = 0;
      markProgress("peer");
    }
    if (
      !createdThisRoom &&
      !guestReady &&
      active &&
      !ignoreEmptyPeerStall &&
      peers.length === 0 &&
      sawPeerDuringBootstrap &&
      (bootstrapPhase === "receiving-project" ||
        bootstrapPhase === "verifying-project")
    ) {
      // Host/sealer departed after we had already connected to them.
      bootstrapPhase = "stalled-project";
      emitState();
      return;
    }
    recomputeLeadership();
  });
  provider.on("signaling", () => {
    if (provider.getSignalingPeers().length === 0) return;
    sawSignalingPeer = true;
    if (!createdThisRoom && !guestReady) {
      markProgress("signaling");
      emitState();
    }
  });
  provider.on("awareness", recomputeLeadership);

  const doLocalPush = (): void => {
    localTimer = null;
    pushPendingLocalChanges();
  };

  return {
    domain,
    provider,
    start({host}) {
      maySeed = host;
      createdThisRoom = host;
      provider.setPresence({eligible: selfEligible});
      if (host) {
        const sealed = performInitialHostSeal();
        if (!sealed.ok) {
          bootstrapPhase = "idle";
          emitState();
          return sealed;
        }
        bootstrapPhase = "ready";
        guestReady = true;
        signalingAutoReconnects = 0;
        active = true;
        provider.connect();
        wasLeader = true;
        recomputeLeadership();
        emitState();
        return {ok: true as const};
      }
      bootstrapPhase = "receiving-project";
      sawPeerDuringBootstrap = false;
      sawSignalingPeer = false;
      signalingAutoReconnects = 0;
      lastProgressAt = Date.now();
      armStallTimer();
      active = true;
      provider.connect();
      recomputeLeadership();
      emitState();
      return {ok: true as const};
    },
    leave() {
      const shouldRollbackGuestInitial =
        guestInitialCopyApplied && !guestReady;
      domain.releaseStagingGuardResources();
      if (localTimer) {
        clearTimeout(localTimer);
        localTimer = null;
      }
      if (assetRetryTimer) {
        clearTimeout(assetRetryTimer);
        assetRetryTimer = null;
      }
      if (applyTimer) {
        clearTimeout(applyTimer);
        applyTimer = null;
      }
      if (sealTimer) {
        clearTimeout(sealTimer);
        sealTimer = null;
      }
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      if (guestEvaluateTimer) {
        clearTimeout(guestEvaluateTimer);
        guestEvaluateTimer = null;
      }
      active = false;
      ignoreEmptyPeerStall = true;
      provider.disconnect();
      ignoreEmptyPeerStall = false;
      maySeed = false;
      createdThisRoom = false;
      guestReady = false;
      guestApplyInFlight = false;
      stagingChangedDuringGuestApply = false;
      guestInitialCopyApplied = false;
      bootstrapPhase = "idle";
      sawPeerDuringBootstrap = false;
      sawSignalingPeer = false;
      signalingAutoReconnects = 0;
      validatedMaterialization = null;
      leadership = null;
      leadershipGeneration += 1;
      leadershipReady = true;
      wasLeader = false;
      seenAsFollower = false;
      conflict = false;
      issueCodes = [];
      emitState();
      if (shouldRollbackGuestInitial && options.rollbackGuestInitialLocal) {
        void Promise.resolve(options.rollbackGuestInitialLocal());
      }
    },
    noteLocalChange() {
      if (suppressLocal || !active) return;
      // Guests must not publish project edits before ready.
      if (!createdThisRoom && !guestReady) return;
      capturePendingLocalChanges();
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(doLocalPush, debounceMs);
    },
    reportDriveConflict() {
      conflict = true;
      emitState();
    },
    clearDriveConflict() {
      if (!conflict) return;
      conflict = false;
      emitState();
    },
    canPersistToDrive(persistOptions) {
      const explicit = persistOptions?.explicit === true;
      if (!active) return {ok: true};
      if (!createdThisRoom) {
        return {ok: false, reason: "Only the room creator can save to Drive"};
      }
      if (bootstrapPhase !== "ready") {
        return {ok: false, reason: "Collaboration bootstrap is not ready"};
      }
      if (conflict && !explicit) {
        return {
          ok: false,
          reason: "Resolve the collaboration conflict before saving to Drive",
        };
      }
      if (provider.getStatus() !== "connected") {
        if (explicit) return {ok: true};
        return {
          ok: false,
          reason: "Collaboration is disconnected; Drive saving is paused",
        };
      }
      // Leadership reobserve remains diagnostic-only and does not authorize.
      void leadershipReady;
      return {ok: true};
    },
    leadershipEpoch() {
      return leadership?.epoch ?? "0";
    },
    isLeader() {
      return active && leaderMatches(leadership, options.participantId);
    },
    createdThisRoom() {
      return createdThisRoom;
    },
    getBootstrapPhase() {
      return bootstrapPhase;
    },
    getState() {
      return {
        status: provider.getStatus(),
        peerCount: provider.getPeers().length,
        role: role(),
        epoch: leadership?.epoch ?? null,
        conflict,
        bootstrapPhase,
        createdThisRoom,
        verifiedAssets,
        expectedAssets,
        receivedBytes,
        issueCodes: [...issueCodes],
        signalingPeerCount: provider.getSignalingPeers().length,
        joinedTopic: provider.hasJoinedTopic(),
      };
    },
    async flush() {
      if (localTimer) {
        clearTimeout(localTimer);
        doLocalPush();
      }
      if (sealTimer && createdThisRoom) {
        clearTimeout(sealTimer);
        sealTimer = null;
        await publishRollingSeal(sealGeneration);
      }
      if (guestEvaluateTimer) {
        clearTimeout(guestEvaluateTimer);
        guestEvaluateTimer = null;
        await evaluateGuestBootstrap();
      }
      if (applyTimer) {
        clearTimeout(applyTimer);
        applyTimer = null;
        runApplyToLocal();
      }
      await provider.flush();
      await applyPending;
      if (!createdThisRoom && !guestReady) {
        await evaluateGuestBootstrap();
      }
      await provider.flush();
      await applyPending;
    },
    async retryLocalSave() {
      if (bootstrapPhase !== "local-save-failed" || !validatedMaterialization) {
        return;
      }
      bootstrapPhase = "receiving-project";
      issueCodes = [];
      emitState();
      if (guestEvaluateTimer) {
        clearTimeout(guestEvaluateTimer);
        guestEvaluateTimer = null;
      }
      await evaluateGuestBootstrap();
    },
    reconnectBootstrap() {
      if (bootstrapPhase !== "stalled-project") return;
      bootstrapPhase = "receiving-project";
      signalingAutoReconnects = 0;
      lastProgressAt = Date.now();
      armStallTimer();
      // Always cycle the transport: signaling can stay "connected" after the
      // data channel dies, and a no-op connect() leaves the guest stranded.
      forceTransportReconnect();
      scheduleGuestEvaluate();
      emitState();
    },
    getDiagnostics() {
      return {
        phase: bootstrapPhase,
        issueCodes: [...issueCodes],
        verifiedAssets,
        expectedAssets,
        receivedBytes,
        peerCount: provider.getPeers().length,
        createdThisRoom,
        status: provider.getStatus(),
        sawPeerDuringBootstrap,
        signalingPeerCount: provider.getSignalingPeers().length,
        sawSignalingPeer,
        joinedTopic: provider.hasJoinedTopic(),
        signalingError: provider.getSignalingError(),
      };
    },
    getValidatedMaterialization() {
      return validatedMaterialization
        ? {
            document: validatedMaterialization.document,
            assets: new Map(validatedMaterialization.assets),
          }
        : null;
    },
  };
}
