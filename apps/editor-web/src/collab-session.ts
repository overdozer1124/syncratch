/**
 * Editor collaboration orchestration.
 *
 * Ties together the schema-2 project collaboration domain, the Yjs/WebRTC
 * provider, and deterministic leader election. It binds VM changes into Yjs
 * (generation/loop safe) and materialized remote Yjs state back into the local
 * project, keeps a per-peer IndexedDB copy via the injected apply callback, and
 * gates durable Drive snapshots so only the current leader writes. On a reported
 * partition/conflict it stops automatic Drive saving without discarding local
 * state.
 */
import * as Y from "yjs";
import {
  LOCAL_ORIGIN,
  ProjectCollaborationDocument,
} from "@blocksync/collaboration-domain";
import type {CollabProvider} from "@blocksync/collab-webrtc";
import {electLeader, isLeader as leaderMatches, type LeadershipState} from "@blocksync/collab-leader";
import type {ProjectDocument} from "@blocksync/project-schema";

export interface CollabReadinessInput {
  googleConnected: boolean;
  driveFileId: string | undefined;
  signalingUrl: string;
}

export type CollabReadiness = {ok: true} | {ok: false; reason: string};

/** Create/join require: Google connected, a linked Drive file, and signaling. */
export function evaluateCollabReadiness(input: CollabReadinessInput): CollabReadiness {
  if (!input.googleConnected) {
    return {ok: false, reason: "Connect Google before collaborating"};
  }
  if (!input.driveFileId) {
    return {ok: false, reason: "Link this project to a Drive file before collaborating"};
  }
  if (!input.signalingUrl || input.signalingUrl.trim().length === 0) {
    return {ok: false, reason: "Collaboration signaling is not configured"};
  }
  return {ok: true};
}

export type CollabRole = "solo" | "leader" | "follower";

export interface CollabState {
  status: string;
  peerCount: number;
  role: CollabRole;
  epoch: string | null;
  conflict: boolean;
}

export interface LocalMaterialization {
  document: ProjectDocument;
  assets: Map<string, Uint8Array>;
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
  ) => void | Promise<void>;
  /** Whether this peer is eligible for leadership (authenticated + Drive verified). */
  eligible?: boolean;
  debounceMs?: number;
  onState?: (state: CollabState) => void;
}

export interface CollabSession {
  start(options: {host: boolean}): void;
  leave(): void;
  noteLocalChange(): void;
  reportDriveConflict(): void;
  canPersistToDrive(): {ok: boolean; reason?: string};
  leadershipEpoch(): string;
  isLeader(): boolean;
  getState(): CollabState;
  flush(): Promise<void>;
  readonly domain: ProjectCollaborationDocument;
  readonly provider: CollabProvider;
}

export function createCollabSession(options: CollabSessionOptions): CollabSession {
  const domain = new ProjectCollaborationDocument();
  const selfEligible = options.eligible ?? true;
  const debounceMs = options.debounceMs ?? 250;

  const provider = options.createProvider({
    doc: domain.ydoc,
    secret: options.secret,
    participantId: options.participantId,
    applyRemoteUpdate: (update) => domain.tryApplyRemoteUpdate(update).accepted,
    isLocalOrigin: (origin) => origin === LOCAL_ORIGIN,
  });

  let active = false;
  let conflict = false;
  let suppressLocal = false;
  let leadership: LeadershipState | null = null;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let applyPending: Promise<void> = Promise.resolve();

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
    });
  };

  const recomputeLeadership = (): void => {
    const participants = [{participantId: options.participantId, eligible: selfEligible}];
    for (const [peerId, state] of provider.getAwareness()) {
      participants.push({participantId: peerId, eligible: state.eligible !== false});
    }
    leadership = electLeader(options.roomId, participants);
    emitState();
  };

  const scheduleApplyToLocal = (): void => {
    applyPending = applyPending
      .then(async () => {
        const result = domain.materialize();
        if (!result.ok) return;
        suppressLocal = true;
        try {
          await options.applyRemoteToLocal(result.document, result.assets);
        } finally {
          suppressLocal = false;
        }
      })
      .catch(() => undefined);
  };

  domain.onRemoteChange(() => {
    scheduleApplyToLocal();
    emitState();
  });
  provider.on("status", emitState);
  provider.on("peers", recomputeLeadership);
  provider.on("awareness", recomputeLeadership);

  const doLocalPush = (): void => {
    localTimer = null;
    syncLocalToDoc();
  };

  return {
    domain,
    provider,
    start({host}) {
      provider.setPresence({eligible: selfEligible});
      if (host) syncLocalToDoc();
      provider.connect();
      active = true;
      recomputeLeadership();
      emitState();
    },
    leave() {
      if (localTimer) {
        clearTimeout(localTimer);
        localTimer = null;
      }
      provider.disconnect();
      active = false;
      leadership = null;
      conflict = false;
      emitState();
    },
    noteLocalChange() {
      if (suppressLocal || !active) return;
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(doLocalPush, debounceMs);
    },
    reportDriveConflict() {
      conflict = true;
      emitState();
    },
    canPersistToDrive() {
      if (conflict) {
        return {ok: false, reason: "Resolve the collaboration conflict before saving to Drive"};
      }
      if (!active) return {ok: true};
      if (leaderMatches(leadership, options.participantId)) return {ok: true};
      return {ok: false, reason: "Only the room leader saves to Drive"};
    },
    leadershipEpoch() {
      return leadership?.epoch ?? "0";
    },
    isLeader() {
      return active && leaderMatches(leadership, options.participantId);
    },
    getState() {
      return {
        status: provider.getStatus(),
        peerCount: provider.getPeers().length,
        role: role(),
        epoch: leadership?.epoch ?? null,
        conflict,
      };
    },
    async flush() {
      if (localTimer) {
        clearTimeout(localTimer);
        doLocalPush();
      }
      await provider.flush();
      await applyPending;
      await provider.flush();
      await applyPending;
    },
  };
}
