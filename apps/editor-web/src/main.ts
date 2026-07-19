import "./style.css";
import {
  LOCAL_PROJECT_FORMAT,
  type LocalProjectRecord,
} from "@blocksync/project-local-core";
import {
  openProjectStore,
  ProjectStoreTransactionError,
  type ProjectStore,
} from "@blocksync/project-store-idb";
import {
  documentToProjectJson,
  exportSb3,
  loadSb3,
  projectJsonToDocument,
  sha256Hex,
} from "@blocksync/sb3-tools/browser";
import {
  createDriveRestAdapter,
  createGoogleAuthorization,
  createGooglePicker,
  loadGoogleScripts,
  type GoogleIdentityGlobal,
  type PickerBuildOptions,
} from "@blocksync/google-drive-sync";
import {
  createSaveCoordinator,
  type LocalSaveState,
  type SaveCoordinator,
} from "./save-coordinator.js";
import {
  collectRuntimeAssetBytes,
  type RuntimeAssetTarget,
} from "./runtime-assets.js";
import {downloadFilename} from "./download-filename.js";
import {shouldExposeTask3Diagnostics} from "./diagnostics.js";
import {readSb3File} from "./import-file.js";
import {loadRecordSafely} from "./load-record.js";
import {createAssetHashCache} from "./asset-hash-cache.js";
import {preserveTargetIds} from "./target-identity.js";
import {staticAssetUrl} from "./static-url.js";
import {
  createProjectSessionTracker,
  type ProjectSession,
} from "./project-session.js";
import {
  createMemoryAssetLoader,
  type MemoryAssetStorage,
} from "./scratch-storage-loader.js";
import {
  createEditorDriveIntegration,
  type EditorDriveIntegration,
  type EditorDriveStatus,
} from "./drive-integration.js";
import {persistDriveFileIdAndSyncCurrent} from "./drive-file-current.js";
import {prepareCommittedDriveExport} from "./drive-export.js";
import {
  createInvite,
  decodeInviteFragment,
  deriveSignalingTopic,
  inviteUrl,
  parseInviteFromUrl,
  type CollabInvite,
} from "@blocksync/collab-invite";
import {createWebRtcProvider} from "@blocksync/collab-webrtc";
import {
  createCollabSession,
  evaluateCollabReadiness,
  type CollabSession,
  type CollabState,
} from "./collab-session.js";

type ProjectDocument = LocalProjectRecord["document"];

interface VmBlocks {
  createBlock(block: Record<string, unknown>): void;
  getBlock(id: string): unknown;
}

interface ScratchVm {
  attachStorage(storage: ScratchStorageInstance): void;
  loadProject(project: unknown): Promise<void>;
  toJSON(): string;
  on(event: string, listener: () => void): void;
  emit(event: string): void;
  runtime: {
    targets: Array<{
      isStage: boolean;
      blocks: VmBlocks;
      getName(): string;
      sprite: {name: string};
    } & RuntimeAssetTarget>;
  };
}

interface ScratchStorageInstance extends MemoryAssetStorage {
  addHelper(helper: {
    load(
      assetType: unknown,
      assetId: string,
      dataFormat: string,
    ): Promise<unknown>;
  }): void;
}

interface ScratchGuiGlobal {
  ScratchStorage: new () => ScratchStorageInstance;
  EditorState: new (options: {isEmbedded: boolean}) => unknown;
  createStandaloneRoot(
    state: unknown,
    element: HTMLElement,
  ): {
    render(options: {
      canEditTitle: boolean;
      canSave: boolean;
      isEmbedded: boolean;
      onVmInit(vm: ScratchVm): void;
    }): void;
  };
}

interface GapiGlobal {
  load(
    module: string,
    options: {
      callback(): void;
      onerror(): void;
    },
  ): void;
}

interface PickerView {
  setMimeTypes(mimeTypes: string): void;
}

interface PickerBuilder {
  setDeveloperKey(value: string): PickerBuilder;
  setAppId(value: string): PickerBuilder;
  setOAuthToken(value: string): PickerBuilder;
  addView(value: PickerView): PickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): {setVisible(visible: boolean): void};
}

interface PickerGlobal {
  Action: {PICKED: string; CANCEL: string};
  Response: {DOCUMENTS: string};
  Document: {ID: string};
  ViewId: {DOCS: string};
  View: new (viewId: string) => PickerView;
  DocsUploadView: new () => PickerView;
  PickerBuilder: new () => PickerBuilder;
}

interface GoogleBrowserGlobal extends GoogleIdentityGlobal {
  picker: PickerGlobal;
}

declare const GUI: ScratchGuiGlobal;

const statusText: Record<LocalSaveState, string> = {
  clean: "Saved",
  dirty: "Unsaved",
  saving: "Saving…",
  error: "Save failed",
  conflict: "Conflict",
};

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const titleInput = requiredElement<HTMLInputElement>("project-title");
const newButton = requiredElement<HTMLButtonElement>("new-project");
const openButton = requiredElement<HTMLButtonElement>("open-project");
const fileInput = requiredElement<HTMLInputElement>("open-file");
const downloadButton = requiredElement<HTMLButtonElement>("download-project");
const saveButton = requiredElement<HTMLButtonElement>("save-project");
const retryButton = requiredElement<HTMLButtonElement>("retry-save");
const saveStatus = requiredElement<HTMLElement>("save-status");
const connectGoogleButton =
  requiredElement<HTMLButtonElement>("connect-google");
const openDriveButton = requiredElement<HTMLButtonElement>("open-drive");
const saveDriveButton = requiredElement<HTMLButtonElement>("save-drive");
const disconnectGoogleButton =
  requiredElement<HTMLButtonElement>("disconnect-google");
const driveStatus = requiredElement<HTMLElement>("drive-status");
const createRoomButton = requiredElement<HTMLButtonElement>("create-room");
const joinRoomButton = requiredElement<HTMLButtonElement>("join-room");
const copyInviteButton = requiredElement<HTMLButtonElement>("copy-invite");
const leaveRoomButton = requiredElement<HTMLButtonElement>("leave-room");
const collabInviteInput = requiredElement<HTMLInputElement>("collab-invite");
const collabStatus = requiredElement<HTMLElement>("collab-status");
const guiHost = requiredElement<HTMLElement>("scratch-gui");

let store: ProjectStore;
let vm: ScratchVm;
let current: LocalProjectRecord;
let hasCurrent = false;
let saveCoordinator: SaveCoordinator;
let driveIntegration: EditorDriveIntegration;
let driveReady = false;
let suppressVmChanges = true;
let failNextWrite = false;
let collabSession: CollabSession | null = null;
let activeInvite: CollabInvite | null = null;
let collaborationGeneration = 0;
let collaborationTestGate = false;
const projectSessions = createProjectSessionTracker();
const assetHashCache = createAssetHashCache(sha256Hex);

const diagnostic = {
  ready: false,
  error: null as string | null,
  createTestBlock(id: string, isStage = false): void {
    const target = vm.runtime.targets.find(
      candidate => candidate.isStage === isStage,
    );
    if (!target) throw new Error(isStage ? "Stage target missing" : "Sprite target missing");
    target.blocks.createBlock({
      id,
      opcode: "event_whenflagclicked",
      next: null,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 20,
      y: 20,
    });
    vm.emit("PROJECT_CHANGED");
  },
  hasBlock(id: string, isStage = false): boolean {
    const target = vm.runtime.targets.find(
      candidate => candidate.isStage === isStage,
    );
    return target?.blocks.getBlock(id) !== null &&
      target?.blocks.getBlock(id) !== undefined;
  },
  getState() {
    return {
      localProjectId: current.localProjectId,
      revision: current.revision,
      saveState: saveCoordinator.getState(),
    };
  },
  exportSb3: exportCurrentSb3,
  importSb3: importProject,
  failNextWrite(): void {
    failNextWrite = true;
  },
  async configureCollaborationTestGate(driveFileId: string): Promise<void> {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("Collaboration test gate is available only in E2E mode");
    }
    collaborationTestGate = true;
    const saved = await store.createOrReplace({
      ...current,
      driveFileId,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    }, current.revision);
    current = saved;
    renderCollabIdle();
  },
  renameTarget(isStage: boolean, name: string): void {
    const target = vm.runtime.targets.find(candidate => candidate.isStage === isStage);
    if (!target) throw new Error("Target missing");
    target.sprite.name = name;
    vm.emit("PROJECT_CHANGED");
  },
  targetName(isStage: boolean): string | undefined {
    return vm.runtime.targets.find(candidate => candidate.isStage === isStage)
      ?.getName();
  },
  collaborationDebug() {
    const materialized = collabSession?.domain.materialize();
    return {
      state: collabSession?.getState() ?? null,
      vmTargets: vm.runtime.targets.map(target => ({
        isStage: target.isStage,
        name: target.getName(),
      })),
      localTargets: documentFromVm().targets.map(target => ({
        id: target.id,
        isStage: target.isStage,
        name: target.name,
      })),
      sharedTargets: materialized?.ok
        ? materialized.document.targets.map(target => ({
            id: target.id,
            isStage: target.isStage,
            name: target.name,
          }))
        : null,
      issues: materialized && !materialized.ok ? materialized.issues : null,
    };
  },
};

declare global {
  interface Window {
    __blocksyncTask3?: typeof diagnostic;
  }
}
if (shouldExposeTask3Diagnostics(import.meta.env.MODE)) {
  window.__blocksyncTask3 = diagnostic;
}

function decodeAssets(encoded: Record<string, string>): Map<string, Uint8Array> {
  const assets = new Map<string, Uint8Array>();
  for (const [md5ext, base64] of Object.entries(encoded)) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    assets.set(md5ext, bytes);
  }
  return assets;
}

function assetMap(record: LocalProjectRecord): Map<string, Uint8Array> {
  return new Map(
    record.assets.map(asset => [asset.md5ext, asset.bytes] as const),
  );
}

function assetRecords(
  document: ProjectDocument,
  assets: Map<string, Uint8Array>,
): LocalProjectRecord["assets"] {
  const required = new Set<string>();
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) required.add(costume.md5ext);
    for (const sound of target.sounds ?? []) required.add(sound.md5ext);
  }
  return [...required].map(md5ext => {
    const bytes = assets.get(md5ext);
    if (!bytes) throw new Error(`Missing asset ${md5ext}`);
    return {md5ext, bytes};
  });
}

function attachLocalStorage(record: LocalProjectRecord): void {
  const assets = assetMap(record);
  const storage = new GUI.ScratchStorage();
  storage.addHelper({
    load: createMemoryAssetLoader(storage, assets),
  });
  vm.attachStorage(storage);
}

function runtimeAssetMap(): Map<string, Uint8Array> {
  return collectRuntimeAssetBytes(assetMap(current), vm.runtime.targets);
}

function documentFromVm(assets = runtimeAssetMap()): ProjectDocument {
  const hashes = assetHashCache.hashesFor(assets);
  return preserveTargetIds(
    current.document,
    projectJsonToDocument(JSON.parse(vm.toJSON()), hashes),
  );
}

async function persistCurrent(session: ProjectSession): Promise<void> {
  if (failNextWrite) {
    failNextWrite = false;
    throw new ProjectStoreTransactionError("Simulated IndexedDB write failure");
  }
  const assets = runtimeAssetMap();
  const document = documentFromVm(assets);
  const next: LocalProjectRecord = {
    ...current,
    title: titleInput.value,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    document,
    assets: assetRecords(document, assets),
    saveState: "clean",
  };
  const saved = await store.createOrReplace(next, current.revision);
  projectSessions.runIfActive(session, () => {
    current = saved;
  });
}

function renderSaveState(state: LocalSaveState): void {
  saveStatus.textContent = statusText[state];
  retryButton.hidden = state !== "error" && state !== "conflict";
}

function installSaveCoordinator(session: ProjectSession): void {
  saveCoordinator?.dispose();
  saveCoordinator = createSaveCoordinator({
    debounceMs: 250,
    save: () => persistCurrent(session),
    onState: state => {
      projectSessions.runIfActive(session, () => renderSaveState(state));
    },
  });
  renderSaveState("clean");
}

function markDirty(): void {
  if (suppressVmChanges) return;
  saveCoordinator.markDirty();
  driveIntegration.markLocalChange();
  collabSession?.noteLocalChange();
}

const signalingUrl =
  import.meta.env.VITE_COLLAB_SIGNALING_URL?.trim() ?? "";

function randomParticipantId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `p-${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function renderCollabIdle(message = "Solo"): void {
  collabStatus.textContent = message;
  const ready = hasCurrent && evaluateCollabReadiness({
    googleConnected:
      collaborationTestGate || (driveReady && driveIntegration.isConnected()),
    driveFileId: current.driveFileId,
    signalingUrl,
  }).ok;
  createRoomButton.disabled = Boolean(collabSession) || !ready;
  joinRoomButton.disabled = Boolean(collabSession) ||
    !(collaborationTestGate || (driveReady && driveIntegration.isConnected())) ||
    signalingUrl.length === 0;
  copyInviteButton.disabled = activeInvite === null;
  leaveRoomButton.disabled = collabSession === null;
}

function renderCollabState(state: CollabState): void {
  const peers = `${state.peerCount} ${state.peerCount === 1 ? "peer" : "peers"}`;
  const conflict = state.conflict ? " · conflict; Drive paused" : "";
  collabStatus.textContent =
    `${state.status} · ${peers} · ${state.role}${conflict}`;
  createRoomButton.disabled = true;
  joinRoomButton.disabled = true;
  copyInviteButton.disabled = activeInvite === null;
  leaveRoomButton.disabled = false;
}

async function applyCollaborativeProject(
  generation: number,
  invite: CollabInvite,
  document: ProjectDocument,
  assets: Map<string, Uint8Array>,
): Promise<void> {
  if (generation !== collaborationGeneration || !collabSession) return;
  await saveCoordinator.flush();
  if (generation !== collaborationGeneration || !collabSession) return;
  const next: LocalProjectRecord = {
    ...current,
    driveFileId: invite.driveFileId,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    document,
    assets: assetRecords(document, assets),
    saveState: "clean",
  };
  const saved = await store.createOrReplace(next, current.revision);
  if (generation !== collaborationGeneration || !collabSession) return;
  await loadRecord(saved);
}

async function startCollaboration(
  invite: CollabInvite,
  host: boolean,
): Promise<void> {
  collabSession?.leave();
  const generation = ++collaborationGeneration;
  const topic = await deriveSignalingTopic(invite);
  if (generation !== collaborationGeneration) return;
  const participantId = randomParticipantId();
  const session = createCollabSession({
    roomId: invite.roomId,
    secret: invite.secret,
    participantId,
    createProvider: config => createWebRtcProvider({
      ...config,
      signalingUrl,
      topic,
    }),
    materializeLocal: () => {
      const assets = runtimeAssetMap();
      return {document: documentFromVm(assets), assets};
    },
    applyRemoteToLocal: (document, assets) =>
      applyCollaborativeProject(generation, invite, document, assets),
    reobserveDriveBeforeLeadership: async () => {
      if (collaborationTestGate) return;
      if (!await driveIntegration.reobserveCurrentFile()) {
        throw new Error("Drive changed during collaboration handoff");
      }
    },
    onState: renderCollabState,
  });
  collabSession = session;
  activeInvite = invite;
  collabInviteInput.value = inviteUrl(window.location.href, invite);
  session.start({host});
}

async function createRoom(): Promise<void> {
  const readiness = evaluateCollabReadiness({
    googleConnected: collaborationTestGate || driveIntegration.isConnected(),
    driveFileId: current.driveFileId,
    signalingUrl,
  });
  if (!readiness.ok) {
    renderCollabIdle(readiness.reason);
    return;
  }
  if (
    !collaborationTestGate &&
    !await driveIntegration.reobserveCurrentFile()
  ) {
    renderCollabIdle("Drive access check failed");
    return;
  }
  await startCollaboration(createInvite(current.driveFileId!), true);
}

function inviteFromInput(): CollabInvite | null {
  const value = collabInviteInput.value.trim();
  return parseInviteFromUrl(value) ?? decodeInviteFragment(value) ??
    decodeInviteFragment(window.location.hash);
}

async function joinRoom(): Promise<void> {
  const invite = inviteFromInput();
  if (!invite) {
    renderCollabIdle("Invalid collaboration invite");
    return;
  }
  const readiness = evaluateCollabReadiness({
    googleConnected: collaborationTestGate || driveIntegration.isConnected(),
    driveFileId: invite.driveFileId,
    signalingUrl,
  });
  if (!readiness.ok) {
    renderCollabIdle(readiness.reason);
    return;
  }
  if (!collaborationTestGate) {
    const opened = await driveIntegration.openCollaborationFile(invite.driveFileId);
    if (!opened) {
      renderCollabIdle("Unable to read the invited Drive file");
      return;
    }
  }
  await startCollaboration(invite, false);
}

function leaveRoom(): void {
  collaborationGeneration += 1;
  collabSession?.leave();
  collabSession = null;
  activeInvite = null;
  renderCollabIdle();
}

async function loadRecord(
  record: LocalProjectRecord,
  signal?: AbortSignal,
): Promise<void> {
  const candidate = structuredClone(record);
  const previous = hasCurrent ? structuredClone(current) : undefined;
  await loadRecordSafely({
    candidate,
    previous,
    setSuppressed(value) {
      suppressVmChanges = value;
    },
    async load(recordToLoad) {
      attachLocalStorage(recordToLoad);
      await vm.loadProject(documentToProjectJson(recordToLoad.document));
      signal?.throwIfAborted();
    },
    commit(loaded) {
      const session = projectSessions.begin();
      current = loaded;
      hasCurrent = true;
      titleInput.value = loaded.title;
      installSaveCoordinator(session);
    },
  });
}

async function loadFixtureRecord(
  localProjectId = crypto.randomUUID(),
  title = "Local project",
): Promise<LocalProjectRecord> {
  const [projectResponse, assetsResponse] = await Promise.all([
    fetch(staticAssetUrl("generated/fixtures/cat-project.json")),
    fetch(staticAssetUrl("generated/fixtures/assets.b64.json")),
  ]);
  if (!projectResponse.ok || !assetsResponse.ok) {
    throw new Error("Failed to load local fixture");
  }
  const assets = decodeAssets(
    (await assetsResponse.json()) as Record<string, string>,
  );
  const hashes = new Map(
    [...assets].map(([md5ext, bytes]) => [md5ext, sha256Hex(bytes)] as const),
  );
  const document = projectJsonToDocument(await projectResponse.json(), hashes);
  return {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId,
    title,
    revision: 0,
    updatedAt: new Date().toISOString(),
    document,
    assets: assetRecords(document, assets),
    saveState: "clean",
  };
}

async function createNewProject(): Promise<void> {
  const record = await loadFixtureRecord();
  await store.createOrReplace(record, null);
  try {
    await loadRecord(record);
  } catch (error) {
    await store.delete(record.localProjectId).catch(() => undefined);
    throw error;
  }
}

async function exportCurrentSb3(): Promise<Uint8Array> {
  const assets = runtimeAssetMap();
  const document = documentFromVm(assets);
  return exportSb3(document, assets);
}

async function exportCommittedCurrentSb3(): Promise<Uint8Array> {
  const committed = structuredClone(current);
  return exportSb3(committed.document, assetMap(committed));
}

async function importProject(
  bytes: Uint8Array,
  title: string,
  driveFileId?: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await loadSb3(bytes);
  if (!result.ok || !result.document || !result.assets) {
    const message = result.issues.map(issue => issue.message).join("; ");
    throw new Error(message || "Invalid SB3");
  }
  const record: LocalProjectRecord = {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId: crypto.randomUUID(),
    title,
    revision: 0,
    updatedAt: new Date().toISOString(),
    document: result.document,
    assets: assetRecords(result.document, result.assets),
    saveState: "clean",
    ...(driveFileId ? {driveFileId} : {}),
  };
  signal?.throwIfAborted();
  await store.createOrReplace(record, null);
  try {
    signal?.throwIfAborted();
    await loadRecord(record, signal);
  } catch (error) {
    await store.delete(record.localProjectId).catch(() => undefined);
    throw error;
  }
}

function download(bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], {type: "application/x.scratch.sb3"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadFilename(titleInput.value);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function getVm(): Promise<ScratchVm> {
  return new Promise(resolve => {
    const state = new GUI.EditorState({isEmbedded: true});
    const root = GUI.createStandaloneRoot(state, guiHost);
    root.render({
      canEditTitle: false,
      canSave: false,
      isEmbedded: true,
      onVmInit: resolve,
    });
  });
}

function googleGlobal(): GoogleBrowserGlobal | undefined {
  return (window as unknown as {google?: GoogleBrowserGlobal}).google;
}

function gapiGlobal(): GapiGlobal | undefined {
  return (window as unknown as {gapi?: GapiGlobal}).gapi;
}

function buildPicker(options: PickerBuildOptions) {
  const picker = googleGlobal()?.picker;
  if (!picker) throw new Error("Google Picker did not initialize");
  const view = new picker.View(picker.ViewId.DOCS);
  view.setMimeTypes(options.mimeType);
  return new picker.PickerBuilder()
    .setDeveloperKey(options.apiKey)
    .setAppId(options.appId)
    .setOAuthToken(options.accessToken)
    .addView(view)
    .addView(new picker.DocsUploadView())
    .setCallback(data => {
      if (data.action === picker.Action.CANCEL) {
        options.callback({action: "cancel"});
        return;
      }
      if (data.action !== picker.Action.PICKED) return;
      const documents = data[picker.Response.DOCUMENTS];
      const first = Array.isArray(documents) ? documents[0] : undefined;
      const fileId = typeof first === "object" && first !== null
        ? (first as Record<string, unknown>)[picker.Document.ID]
        : undefined;
      options.callback({
        action: "picked",
        documents: [{id: typeof fileId === "string" ? fileId : undefined}],
      });
    })
    .build();
}

const driveStatusText: Record<EditorDriveStatus, string> = {
  "not-configured": "Not configured",
  disconnected: "Disconnected",
  connected: "Connected",
  syncing: "Syncing…",
  synced: "Synced",
  unsynced: "Unsynced",
  conflict: "Conflict",
};

function renderDriveStatus(
  status: EditorDriveStatus,
  message?: string,
): void {
  driveStatus.textContent = message
    ? `${driveStatusText[status]}: ${message}`
    : driveStatusText[status];
  driveStatus.title = message ?? "";
  const configured = status !== "not-configured";
  const connected = !["not-configured", "disconnected", "syncing"]
    .includes(status);
  connectGoogleButton.disabled = !driveReady ||
    !configured || status === "connected" || status === "synced" ||
    status === "syncing";
  openDriveButton.disabled = !driveReady || !connected;
  saveDriveButton.disabled =
    !driveReady || !connected || status === "conflict";
  disconnectGoogleButton.disabled =
    !driveReady || !configured || status === "disconnected";
  if (status === "conflict") collabSession?.reportDriveConflict();
  if (!collabSession) renderCollabIdle();
}

async function persistDriveFileId(
  driveFileId: string,
  localProjectId: string,
  signal?: AbortSignal,
): Promise<void> {
  await persistDriveFileIdAndSyncCurrent({
    store,
    driveFileId,
    localProjectId,
    signal,
    getCurrent: () => hasCurrent ? current : undefined,
    setCurrent: saved => {
      if (hasCurrent) current = saved;
    },
  });
}

function setupDriveIntegration(): EditorDriveIntegration {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY?.trim() ?? "";
  const appId = import.meta.env.VITE_GOOGLE_APP_ID?.trim() ?? "";
  const configured = Boolean(clientId && apiKey && appId);
  const scripts = loadGoogleScripts();
  const auth = createGoogleAuthorization({
    clientId,
    loadScripts: scripts,
    getGoogle: googleGlobal,
  });
  const picker = createGooglePicker({
    apiKey,
    appId,
    initializePicker: async () => {
      await scripts();
      const gapi = gapiGlobal();
      if (!gapi) throw new Error("Google API loader did not initialize");
      await new Promise<void>((resolve, reject) => {
        gapi.load("picker", {
          callback: resolve,
          onerror: () => reject(new Error("Google Picker failed to load")),
        });
      });
    },
    buildPicker,
  });
  const drive = createDriveRestAdapter({
    fetch: window.fetch.bind(window),
    getAccessToken: auth.getAccessToken,
    validateSb3: async bytes => {
      const loaded = await loadSb3(bytes);
      return Boolean(loaded.ok && loaded.document && loaded.assets);
    },
  });
  return createEditorDriveIntegration({
    configured,
    auth,
    picker,
    drive,
    exportCurrent: async () => {
      const localProjectId = current.localProjectId;
      return prepareCommittedDriveExport({
        localProjectId,
        flush: () => saveCoordinator.flush(),
        getSaveState: () => saveCoordinator.getState(),
        getCurrentProjectId: () => current.localProjectId,
        exportCommitted: exportCommittedCurrentSb3,
      });
    },
    getCurrent: () => ({
      localProjectId: current.localProjectId,
      title: titleInput.value,
      driveFileId: current.driveFileId,
    }),
    importAsNewLocal: importProject,
    persistDriveFileId,
    hashBytes: async bytes => sha256Hex(bytes),
    createSnapshotId: () => crypto.randomUUID(),
    onStatus: renderDriveStatus,
    getLeadershipEpoch: () => collabSession?.leadershipEpoch() ?? "0",
    canPersistToDrive: () =>
      collabSession?.canPersistToDrive() ?? {ok: true},
  });
}

async function boot(): Promise<void> {
  store = await openProjectStore();
  vm = await getVm();
  vm.on("PROJECT_CHANGED", markDirty);
  const latest = await store.getLatest();
  if (latest === null) {
    const initial = await loadFixtureRecord();
    await store.createOrReplace(initial, null);
    await loadRecord(initial);
  } else {
    await loadRecord(latest);
  }
  diagnostic.ready = true;
  driveReady = true;
  renderDriveStatus(driveIntegration.getStatus());
  const fragmentInvite = decodeInviteFragment(window.location.hash);
  if (fragmentInvite) collabInviteInput.value = window.location.href;
  renderCollabIdle();
}

driveIntegration = setupDriveIntegration();

titleInput.addEventListener("input", markDirty);
newButton.addEventListener("click", () => void createNewProject());
openButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    await importProject(
      await readSb3File(file),
      file.name.replace(/\.sb3$/i, ""),
    );
  } catch {
    saveStatus.textContent = "Import failed";
    retryButton.hidden = true;
  } finally {
    fileInput.value = "";
  }
});
downloadButton.addEventListener("click", () => {
  void exportCurrentSb3().then(download);
});
saveButton.addEventListener("click", () => void saveCoordinator.flush());
retryButton.addEventListener("click", () => void saveCoordinator.flush());
connectGoogleButton.addEventListener("click", () => {
  void driveIntegration.connect();
});
openDriveButton.addEventListener("click", () => {
  void driveIntegration.openFromDrive();
});
saveDriveButton.addEventListener("click", () => {
  void driveIntegration.saveToDrive();
});
disconnectGoogleButton.addEventListener("click", () => {
  leaveRoom();
  driveIntegration.disconnect();
});
createRoomButton.addEventListener("click", () => void createRoom());
joinRoomButton.addEventListener("click", () => void joinRoom());
copyInviteButton.addEventListener("click", () => {
  if (!activeInvite) return;
  void navigator.clipboard.writeText(inviteUrl(window.location.href, activeInvite));
});
leaveRoomButton.addEventListener("click", leaveRoom);

boot().catch(error => {
  diagnostic.error = error instanceof Error ? error.message : String(error);
  saveStatus.textContent = "Error";
});
