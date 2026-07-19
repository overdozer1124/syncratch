/**
 * Browser harness for the real 2-context WebRTC collaboration E2E. It builds a
 * schema-2 collaboration document and a real WebRTC provider (native
 * RTCPeerConnection + WebSocket to the local signaling server), then exposes a
 * minimal control surface on `window.__collab` so Playwright can drive two real
 * Chromium contexts editing different sprites and verify convergence.
 *
 * This harness intentionally exercises only the collaboration transport + domain
 * (no Google/Drive), which is the part that requires a real browser WebRTC stack.
 */
import {
  LOCAL_ORIGIN,
  ProjectCollaborationDocument,
} from "@blocksync/collaboration-domain";
import {createWebRtcProvider, type CollabProvider} from "@blocksync/collab-webrtc";
import type {CostumeRef, ProjectDocument, ScratchTarget} from "@blocksync/project-schema";

if (import.meta.env.MODE !== "e2e") {
  throw new Error("The collaboration harness is available only in E2E mode");
}

function costume(assetId: string): CostumeRef {
  return {
    kind: "costume",
    name: `${assetId}-c`,
    assetId,
    md5ext: `${assetId}.svg`,
    dataFormat: "svg",
    contentSha256: "b".repeat(64),
    rotationCenterX: 0,
    rotationCenterY: 0,
  };
}

function stage(): ScratchTarget {
  return {
    id: "stage",
    name: "Stage",
    isStage: true,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume("cccccccccccccccccccccccccccccccc")],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
  };
}

function sprite(id: string, name: string): ScratchTarget {
  const assetId = `${id}${"a".repeat(32 - id.length)}`;
  return {
    id,
    name,
    isStage: false,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume(assetId)],
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
  };
}

function baseProject(host: boolean): ProjectDocument {
  const targets = host ? [stage(), sprite("s1", "S1"), sprite("s2", "S2")] : [stage()];
  return {schemaVersion: 2, targets, extensions: [], monitors: [], meta: {}};
}

function assetsFor(document: ProjectDocument): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const target of document.targets) {
    for (const c of target.costumes ?? []) map.set(c.md5ext, new Uint8Array([1, 2, 3, 4]));
  }
  return map;
}

interface CollabHarness {
  ready: boolean;
  error: string | null;
  status(): string;
  peers(): string[];
  editTarget(id: string, name: string): boolean;
  targetName(id: string): string | null;
  materializeOk(): boolean;
}

declare global {
  interface Window {
    __collab?: CollabHarness;
  }
}

function boot(): void {
  const params = new URLSearchParams(location.search);
  const signalingUrl = params.get("signalingUrl") ?? "";
  const topic = params.get("topic") ?? "";
  const secret = params.get("secret") ?? "";
  const participantId = params.get("participantId") ?? "peer";
  const host = params.get("host") === "1";

  const domain = new ProjectCollaborationDocument();
  if (host) {
    const project = baseProject(true);
    domain.loadLocalProject(project, assetsFor(project));
  }

  let provider: CollabProvider;
  try {
    provider = createWebRtcProvider({
      doc: domain.ydoc,
      secret,
      topic,
      signalingUrl,
      participantId,
      iceServers: [],
      applyRemoteUpdate: (update) => domain.tryApplyRemoteUpdate(update).accepted,
      isLocalOrigin: (origin) => origin === LOCAL_ORIGIN,
      onDiagnostic: (message) => console.log(`[collab:${participantId}] ${message}`),
    });
  } catch (error) {
    window.__collab = {
      ready: false,
      error: error instanceof Error ? error.message : String(error),
      status: () => "error",
      peers: () => [],
      editTarget: () => false,
      targetName: () => null,
      materializeOk: () => false,
    };
    return;
  }

  provider.connect();

  window.__collab = {
    ready: true,
    error: null,
    status: () => provider.getStatus(),
    peers: () => provider.getPeers(),
    editTarget(id, name) {
      const result = domain.materialize();
      if (!result.ok) return false;
      const target = result.document.targets.find((t) => t.id === id);
      if (!target) return false;
      domain.setTarget({...target, name});
      return true;
    },
    targetName(id) {
      const result = domain.materialize();
      if (!result.ok) return null;
      return result.document.targets.find((t) => t.id === id)?.name ?? null;
    },
    materializeOk: () => domain.materialize().ok,
  };
  const readyEl = document.getElementById("collab-ready");
  if (readyEl) readyEl.textContent = "ready";
}

boot();
