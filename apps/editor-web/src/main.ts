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
import {
  assetRecordsFromMap,
  createCorruptRecordRecovery,
  isMissingAssetError,
  recoverLoadedRecord,
  recordHasMissingStoredAssets,
} from "./local-record-recovery.js";
import {composeProjectStatus} from "./project-status.js";
import {downloadFilename} from "./download-filename.js";
import {shouldExposeTask3Diagnostics} from "./diagnostics.js";
import {readSb3File} from "./import-file.js";
import {
  loadScratchGui,
  setGuiLoadingVisible,
} from "./load-scratch-gui.js";
import {loadRecordSafely} from "./load-record.js";
import {applyGuestInitialProject} from "./guest-project-apply.js";
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
import {
  createDriveAutosave,
  isDriveAutosaveEligible,
  type DriveAutosave,
} from "./drive-autosave.js";
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
  type ApplyRemoteContext,
  type CollabSession,
  type CollabState,
} from "./collab-session.js";
import {summarizePreflightIssues} from "@blocksync/collaboration-domain";

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
  EditorState: new (options?: {isEmbedded?: boolean}) => unknown;
  createStandaloneRoot(
    state: unknown,
    element: HTMLElement,
  ): {
    render(options: {
      canEditTitle: boolean;
      canSave: boolean;
      isEmbedded?: boolean;
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
  setMimeTypes(mimeTypes: string): PickerView;
}

interface DocsView extends PickerView {
  setIncludeFolders(include: boolean): DocsView;
  setEnableDrives(enabled: boolean): DocsView;
  setOwnedByMe(ownedByMe: boolean): DocsView;
  setFileIds(fileIds: string): DocsView;
}

interface PickerBuilder {
  setDeveloperKey(value: string): PickerBuilder;
  setAppId(value: string): PickerBuilder;
  setOAuthToken(value: string): PickerBuilder;
  setOrigin(value: string): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  addView(value: PickerView): PickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): {setVisible(visible: boolean): void};
}

interface PickerGlobal {
  Action: {PICKED: string; CANCEL: string};
  Response: {DOCUMENTS: string};
  Document: {ID: string};
  ViewId: {DOCS: string};
  Feature: {SUPPORT_DRIVES: string};
  View: new (viewId: string) => PickerView;
  DocsView: new () => DocsView;
  DocsUploadView: new () => PickerView;
  PickerBuilder: new () => PickerBuilder;
}

interface GoogleBrowserGlobal extends GoogleIdentityGlobal {
  picker: PickerGlobal;
}

declare const GUI: ScratchGuiGlobal;

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
const projectStatusDetails = requiredElement<HTMLElement>("project-status-details");
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
const collabReconnectButton = requiredElement<HTMLButtonElement>("collab-reconnect");
const collabRetrySaveButton = requiredElement<HTMLButtonElement>("collab-retry-save");
const collabDownloadSb3Button = requiredElement<HTMLButtonElement>("collab-download-sb3");
const collabDiagnosticsButton = requiredElement<HTMLButtonElement>("collab-diagnostics");
const collabInviteInput = requiredElement<HTMLInputElement>("collab-invite");
const collabStatus = requiredElement<HTMLElement>("collab-status");
const guiHost = requiredElement<HTMLElement>("scratch-gui");

let store: ProjectStore;
let vm: ScratchVm;
let current: LocalProjectRecord;
let hasCurrent = false;
let saveCoordinator: SaveCoordinator;
let driveIntegration: EditorDriveIntegration;
let driveAutosave: DriveAutosave;
let driveReady = false;
let suppressVmChanges = true;
let failNextWrite = false;
let collabSession: CollabSession | null = null;
let activeInvite: CollabInvite | null = null;
let collaborationGeneration = 0;
let guestInitialRollback: {
  generation: number;
  previous?: LocalProjectRecord;
  savedId: string;
} | null = null;
let collaborationTestGate = false;
let lastLocalSaveState: LocalSaveState = "clean";
let lastDriveStatus: EditorDriveStatus = "not-configured";
let lastDriveMessage: string | undefined;
let lastCollabState: CollabState | null = null;
let lastCollabIdleMessage = "Solo";
let fatalBootError: string | undefined;
let localOperationError: string | undefined;
const recoveryAssetOverlay = new Map<string, Uint8Array>();
const projectSessions = createProjectSessionTracker();
const corruptRecordRecovery = createCorruptRecordRecovery();
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
  async corruptStoredAssets(): Promise<void> {
    if (!hasCurrent || current.assets.length === 0) {
      throw new Error("No stored assets to corrupt");
    }
    const [removed, ...remaining] = current.assets;
    recoveryAssetOverlay.set(removed.md5ext, removed.bytes);
    current = await store.createOrReplace({
      ...current,
      assets: remaining,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    }, current.revision);
  },
  async localProjectIds(): Promise<string[]> {
    return (await store.list()).map(record => record.localProjectId);
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
      state: collabSession
        ? {
            ...collabSession.getState(),
            // Keep role for harness diagnostics; UI no longer displays it.
            role: collabSession.getState().role,
          }
        : null,
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

async function maybeRecoverCorruptRecord(
  session: ProjectSession,
): Promise<boolean> {
  if (!hasCurrent || !projectSessions.isActive(session)) return false;
  const source = current;
  const assets = runtimeAssetMap();
  const document = documentFromVm(assets);
  return corruptRecordRecovery.recover({
    current: source,
    title: titleInput.value,
    document,
    assets,
    localProjectId: crypto.randomUUID(),
    isActive: () => projectSessions.isActive(session),
    persist: recovery => store.createOrReplace(recovery, null),
    remove: recovery => store.delete(recovery.localProjectId),
    commit(saved) {
      current = saved;
    },
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
  const assets = collectRuntimeAssetBytes(assetMap(current), vm.runtime.targets);
  for (const [md5ext, bytes] of recoveryAssetOverlay) {
    assets.set(md5ext, bytes);
  }
  return assets;
}

function documentFromVm(assets = runtimeAssetMap()): ProjectDocument {
  const hashes = assetHashCache.hashesFor(assets);
  return preserveTargetIds(
    current.document,
    projectJsonToDocument(JSON.parse(vm.toJSON()), hashes),
  );
}

async function persistCurrent(session: ProjectSession): Promise<void> {
  await projectSessions.runSerialized(session, async isActive => {
    if (failNextWrite) {
      failNextWrite = false;
      throw new ProjectStoreTransactionError(
        "Simulated IndexedDB write failure",
      );
    }

    const persistRevision = async (): Promise<void> => {
      if (!isActive()) return;
      const source = current;
      const assets = runtimeAssetMap();
      const document = documentFromVm(assets);
      if (!isActive()) return;
      const next: LocalProjectRecord = {
        ...source,
        title: titleInput.value,
        revision: source.revision + 1,
        updatedAt: new Date().toISOString(),
        document,
        assets: assetRecordsFromMap(document, assets),
        saveState: "clean",
      };
      const saved = await store.createOrReplace(next, source.revision);
      if (!isActive()) return;
      current = saved;
      recoveryAssetOverlay.clear();
    };

    try {
      await maybeRecoverCorruptRecord(session);
      if (!isActive()) return;
      await persistRevision();
    } catch (error) {
      if (!isMissingAssetError(error)) throw error;
      if (!isActive()) return;
      if (!await maybeRecoverCorruptRecord(session)) throw error;
      if (!isActive()) return;
      await persistRevision();
    }
  });
}

function renderProjectStatus(): void {
  const {primary, details} = composeProjectStatus({
    local: lastLocalSaveState,
    drive: lastDriveStatus,
    driveMessage: lastDriveMessage,
    collab: lastCollabState,
    collabIdleMessage: lastCollabIdleMessage,
    fatalError: fatalBootError,
    localError: localOperationError,
  });
  saveStatus.textContent = primary;
  saveStatus.title = fatalBootError ?? "";
  projectStatusDetails.textContent = details ? ` · ${details}` : "";
  projectStatusDetails.hidden = details.length === 0;
}

function renderSaveState(state: LocalSaveState): void {
  lastLocalSaveState = state;
  localOperationError = undefined;
  retryButton.hidden = state !== "error" && state !== "conflict";
  renderProjectStatus();
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
  // Only the room-creating device may mark Drive unsynced / autosave.
  if (!collabSession || collabSession.createdThisRoom()) {
    driveIntegration.markLocalChange();
    driveAutosave?.noteChange();
  }
  collabSession?.noteLocalChange();
}

const signalingUrl =
  import.meta.env.VITE_COLLAB_SIGNALING_URL?.trim() ?? "";

function randomParticipantId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `p-${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function renderBootstrapActions(state: CollabState | null): void {
  const phase = state?.bootstrapPhase ?? "idle";
  collabReconnectButton.hidden = phase !== "stalled-project";
  collabRetrySaveButton.hidden = phase !== "local-save-failed";
  collabDownloadSb3Button.hidden = phase !== "local-save-failed";
  collabDiagnosticsButton.hidden = !(
    phase === "stalled-project" ||
    phase === "invalid-project" ||
    phase === "local-save-failed" ||
    phase === "receiving-project" ||
    phase === "verifying-project"
  );
  const bootstrapping = Boolean(
    state &&
    !state.createdThisRoom &&
    phase !== "ready" &&
    phase !== "idle",
  );
  guiHost.classList.toggle("collab-bootstrap-locked", bootstrapping);
}

function renderCollabIdle(message = "Solo"): void {
  lastCollabState = null;
  lastCollabIdleMessage = message;
  collabStatus.textContent = message;
  const ready = hasCurrent && evaluateCollabReadiness({signalingUrl}).ok;
  createRoomButton.disabled = Boolean(collabSession) || !ready;
  joinRoomButton.disabled = Boolean(collabSession) || !ready;
  copyInviteButton.disabled = activeInvite === null;
  leaveRoomButton.disabled = collabSession === null;
  renderBootstrapActions(null);
  renderProjectStatus();
}

function renderCollabState(state: CollabState): void {
  lastCollabState = state;
  if (state.bootstrapPhase === "ready") {
    guestInitialRollback = null;
  }
  const peers = `${state.peerCount} ${state.peerCount === 1 ? "peer" : "peers"}`;
  const conflict = state.conflict ? " · conflict; Drive paused" : "";
  const assets =
    state.bootstrapPhase === "ready" || state.expectedAssets === 0
      ? ""
      : ` · 素材 ${state.verifiedAssets}/${state.expectedAssets}`;
  const phase =
    state.bootstrapPhase === "ready"
      ? "ready"
      : state.bootstrapPhase;
  collabStatus.textContent =
    `${state.status} · ${peers} · ${phase}${assets}${conflict}`;
  driveAutosave?.eligibilityChanged();
  createRoomButton.disabled = true;
  joinRoomButton.disabled = true;
  copyInviteButton.disabled = activeInvite === null;
  leaveRoomButton.disabled = false;
  renderBootstrapActions(state);
  renderProjectStatus();
}

async function rollbackGuestInitialLocal(generation: number): Promise<void> {
  const pending = guestInitialRollback;
  if (!pending || pending.generation !== generation) return;
  guestInitialRollback = null;
  try {
    await store.delete(pending.savedId);
  } catch {
    // Best-effort cleanup of the tentative guest copy.
  }
  if (pending.previous) {
    await loadRecord(pending.previous);
    return;
  }
  hasCurrent = false;
}

async function applyCollaborativeProject(
  generation: number,
  document: ProjectDocument,
  assets: Map<string, Uint8Array>,
  context: ApplyRemoteContext,
): Promise<void | boolean> {
  if (generation !== collaborationGeneration || !collabSession) return false;
  await saveCoordinator.flush();
  if (generation !== collaborationGeneration || !collabSession) return false;

  if (context.mode === "guest-initial") {
    driveAutosave?.cancel();
    const previous = hasCurrent ? structuredClone(current) : undefined;
    const record: LocalProjectRecord = {
      format: LOCAL_PROJECT_FORMAT,
      localProjectId: crypto.randomUUID(),
      title: context.projectTitle ?? "共同編集プロジェクト",
      revision: 0,
      updatedAt: new Date().toISOString(),
      document,
      assets: assetRecordsFromMap(document, assets),
      saveState: "clean",
    };
    const applied = await applyGuestInitialProject({
      candidate: record,
      previous,
      isActive: () =>
        generation === collaborationGeneration && collabSession !== null,
      async load(recordToLoad) {
        attachLocalStorage(recordToLoad);
        await vm.loadProject(documentToProjectJson(recordToLoad.document));
      },
      persist: candidate => store.createOrReplace(candidate, null),
      remove: saved => store.delete(saved.localProjectId),
      commit(saved) {
        const session = projectSessions.begin();
        current = saved;
        hasCurrent = true;
        titleInput.value = saved.title;
        installSaveCoordinator(session);
      },
      setSuppressed(value) {
        suppressVmChanges = value;
      },
    });
    if (applied) {
      guestInitialRollback = {
        generation,
        previous,
        savedId: current.localProjectId,
      };
    }
    return applied;
  }

  const next: LocalProjectRecord = {
    ...current,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    document,
    assets: assetRecordsFromMap(document, assets),
    saveState: "clean",
  };
  const saved = await store.createOrReplace(next, current.revision);
  if (generation !== collaborationGeneration || !collabSession) return false;
  await loadRecord(saved);
  return true;
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
      onDiagnostic: message => {
        console.info(`[collab:${participantId}] ${message}`);
      },
    }),
    materializeLocal: () => {
      const assets = runtimeAssetMap();
      return {document: documentFromVm(assets), assets};
    },
    applyRemoteToLocal: async (document, assets, context) => {
      const applied = await applyCollaborativeProject(
        generation,
        document,
        assets,
        context,
      );
      if (applied === false) return false;
      if (collabSession?.createdThisRoom()) {
        driveIntegration.markLocalChange();
        driveAutosave.noteChange();
      }
      return true;
    },
    rollbackGuestInitialLocal: () => rollbackGuestInitialLocal(generation),
    projectTitle: () => titleInput.value,
    reobserveDriveBeforeLeadership: async () => {
      if (collaborationTestGate) return;
      if (!current.driveFileId) return;
      if (!await driveIntegration.reobserveCurrentFile()) {
        throw new Error("Drive changed during collaboration handoff");
      }
    },
    onState: renderCollabState,
  });
  collabSession = session;
  activeInvite = invite;
  collabInviteInput.value = inviteUrl(window.location.href, invite);
  const started = session.start({host});
  if (!started.ok) {
    const summary = summarizePreflightIssues(started.issues);
    collabSession = null;
    activeInvite = null;
    renderCollabIdle(summary.summary);
    collabStatus.title = summary.codes.join(", ");
  }
}

async function createRoom(): Promise<void> {
  try {
    const readiness = evaluateCollabReadiness({signalingUrl});
    if (!readiness.ok) {
      renderCollabIdle(readiness.reason);
      return;
    }
    await startCollaboration(createInvite(), true);
  } catch (error) {
    renderCollabIdle(
      error instanceof Error ? error.message : "Could not create room",
    );
  }
}

function inviteFromInput(): CollabInvite | null {
  const value = collabInviteInput.value.trim();
  return parseInviteFromUrl(value) ?? decodeInviteFragment(value) ??
    decodeInviteFragment(window.location.hash);
}

async function joinRoom(): Promise<void> {
  try {
    const invite = inviteFromInput();
    if (!invite) {
      renderCollabIdle("Invalid collaboration invite");
      return;
    }
    const readiness = evaluateCollabReadiness({signalingUrl});
    if (!readiness.ok) {
      renderCollabIdle(readiness.reason);
      return;
    }
    await startCollaboration(invite, false);
  } catch (error) {
    renderCollabIdle(
      error instanceof Error ? error.message : "Could not join room",
    );
  }
}

function leaveRoom(): void {
  driveAutosave?.cancel();
  // Leave before bumping generation so tentative guest-initial rollback can run.
  collabSession?.leave();
  collaborationGeneration += 1;
  collabSession = null;
  activeInvite = null;
  renderCollabIdle();
}

async function loadRecord(
  record: LocalProjectRecord,
  signal?: AbortSignal,
): Promise<void> {
  driveAutosave?.cancel();
  const candidate = structuredClone(record);
  const previous = hasCurrent ? structuredClone(current) : undefined;
  const session = projectSessions.begin();
  saveCoordinator?.dispose();
  try {
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
        current = loaded;
        hasCurrent = true;
        titleInput.value = loaded.title;
        installSaveCoordinator(session);
        if (recordHasMissingStoredAssets(loaded)) {
          void recoverLoadedRecord({coordinator: saveCoordinator});
        }
      },
    });
  } catch (error) {
    if (previous) installSaveCoordinator(session);
    throw error;
  }
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
    assets: assetRecordsFromMap(document, assets),
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
    assets: assetRecordsFromMap(result.document, result.assets),
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
  setGuiLoadingVisible(guiHost, true);
  saveStatus.textContent = "Loading editor…";
  await loadScratchGui();
  return new Promise(resolve => {
    // Full editor (not embedded/player-only) so students can edit blocks.
    // EditorState requires a params object — undefined crashes boot.
    const state = new GUI.EditorState({});
    const root = GUI.createStandaloneRoot(state, guiHost);
    root.render({
      canEditTitle: false,
      canSave: false,
      onVmInit: vmInstance => {
        setGuiLoadingVisible(guiHost, false);
        resolve(vmInstance);
      },
    });
  });
}

function googleGlobal(): GoogleBrowserGlobal | undefined {
  return (window as unknown as {google?: GoogleBrowserGlobal}).google;
}

function gapiGlobal(): GapiGlobal | undefined {
  return (window as unknown as {gapi?: GapiGlobal}).gapi;
}

function raisePickerAboveEditor(): void {
  for (const el of document.querySelectorAll<HTMLElement>(
    ".picker-dialog, .picker-dialog-bg",
  )) {
    el.style.zIndex = "2147483647";
  }
}

function buildPicker(options: PickerBuildOptions) {
  const picker = googleGlobal()?.picker;
  if (!picker) throw new Error("Google Picker did not initialize");
  // Do not filter by MIME: Chromebook/Drive uploads rarely use
  // application/x.scratch.sb3. Invalid picks are rejected on download.
  void options.mimeType;
  const builder = new picker.PickerBuilder()
    .enableFeature(picker.Feature.SUPPORT_DRIVES)
    .setDeveloperKey(options.apiKey)
    .setAppId(options.appId)
    .setOAuthToken(options.accessToken)
    .setOrigin(window.location.origin);

  if (options.fileIds && options.fileIds.length > 0) {
    // Collaboration join: show only the invited file. Avoid setEnableDrives —
    // that mode is Shared drives only and hid "Shared with me".
    builder.addView(
      new picker.DocsView().setFileIds(options.fileIds.join(",")),
    );
  } else {
    // Open: My Drive first, then Shared with me, then Shared drives.
    // setEnableDrives(true) means shared-drives-only, so keep it as a tab.
    builder
      .addView(new picker.DocsView().setIncludeFolders(true))
      .addView(new picker.DocsView().setOwnedByMe(false))
      .addView(
        new picker.DocsView()
          .setIncludeFolders(true)
          .setEnableDrives(true),
      )
      .addView(new picker.DocsUploadView());
  }

  const built = builder
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
        documents: typeof fileId === "string" ? [{id: fileId}] : [],
      });
    })
    .build();
  return {
    setVisible(visible: boolean) {
      built.setVisible(visible);
      if (visible) {
        raisePickerAboveEditor();
        requestAnimationFrame(raisePickerAboveEditor);
      }
    },
  };
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
  lastDriveStatus = status;
  lastDriveMessage = message;
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
  // Keep Save enabled during conflict so the user can explicitly retry after
  // re-baselining; automatic background writes remain gated elsewhere.
  saveDriveButton.disabled = !driveReady || !connected;
  disconnectGoogleButton.disabled =
    !driveReady || !configured || status === "disconnected";
  if (status === "conflict") collabSession?.reportDriveConflict();
  if (status === "synced") collabSession?.clearDriveConflict();
  if (!collabSession) renderCollabIdle();
  else renderProjectStatus();
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
    canPersistToDrive: options =>
      collabSession?.canPersistToDrive(options) ?? {ok: true},
  });
}

async function boot(): Promise<void> {
  // Overlap IndexedDB open with the large Scratch GUI download.
  const guiReady = getVm();
  store = await openProjectStore();
  vm = await guiReady;
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
  await driveIntegration.tryRestoreSession();
  const fragmentInvite = decodeInviteFragment(window.location.hash);
  if (fragmentInvite) collabInviteInput.value = window.location.href;
  renderCollabIdle();
}

driveIntegration = setupDriveIntegration();
driveAutosave = createDriveAutosave({
  delayMs: 2_000,
  isEligible: () => {
    const state = collabSession?.getState();
    return hasCurrent && isDriveAutosaveEligible({
      driveConnected: driveIntegration.isConnected(),
      createdThisRoom: Boolean(state?.createdThisRoom),
      bootstrapReady: state?.bootstrapPhase === "ready",
      driveFileId: current.driveFileId,
      collaborationConnected: state?.status === "connected",
      conflict: Boolean(state?.conflict),
    });
  },
  save: () => driveIntegration.saveToDrive({explicit: false}),
});

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
    localOperationError = "Import failed";
    renderProjectStatus();
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
  driveAutosave.cancel();
  void driveIntegration.saveToDrive({explicit: true});
});
disconnectGoogleButton.addEventListener("click", () => {
  driveAutosave.cancel();
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
collabReconnectButton.addEventListener("click", () => {
  collabSession?.reconnectBootstrap();
});
collabRetrySaveButton.addEventListener("click", () => {
  void collabSession?.retryLocalSave();
});
collabDownloadSb3Button.addEventListener("click", () => {
  const materialization = collabSession?.getValidatedMaterialization();
  if (!materialization) return;
  void exportSb3(materialization.document, materialization.assets).then(download);
});
collabDiagnosticsButton.addEventListener("click", () => {
  const diagnostics = collabSession?.getDiagnostics();
  if (!diagnostics) return;
  const text = JSON.stringify(diagnostics);
  void navigator.clipboard.writeText(text).then(() => {
    collabStatus.title = "Diagnostics copied";
  });
});

boot().catch(error => {
  diagnostic.error = error instanceof Error ? error.message : String(error);
  fatalBootError = diagnostic.error ?? "Boot failed";
  driveReady = false;
  renderDriveStatus(driveIntegration.getStatus());
});
