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
  consumeDriveOAuthReturnFlag,
  createDriveRestAdapter,
  createGoogleAuthorization,
  createGooglePicker,
  createHostBackedGoogleAuthorization,
  loadGoogleScripts,
  probeHostDriveOAuthAvailable,
  type GoogleAuthorization,
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
import {
  collaborationStatusText,
} from "./project-status.js";
import {
  composeProjectStatusView,
  renderStatusIconRow,
} from "./status-icons.js";
import {
  drivePanelStatusText,
  friendlyCollaborationMessage,
  friendlyDriveMessage,
} from "./ui-copy.js";
import {
  DEFAULT_GUEST_COLLAB_TITLE,
  friendlyProjectTitle,
} from "./project-title.js";
import {installScratchAccessibility} from "./scratch-accessibility.js";
import {
  DRIVE_OVERWRITE_CONFIRMATION_REASON,
  driveConflictAction,
  shouldLatchDriveOverwriteConfirmation,
} from "./drive-conflict-status.js";
import {
  GUEST_DRIVE_SAVE_BLOCKED_STATUS,
  driveControlFlags,
} from "./collab-role-ui.js";
import {
  closeOpenToolPanels,
  shouldCloseToolPanelsOnKey,
  shouldCloseToolPanelsOnOutsideTarget,
} from "./tool-panel-dismiss.js";
import {installSyncratchChromeLayout} from "./unified-chrome.js";
import {shouldLeaveCollaborationOnGoogleDisconnect} from "./google-disconnect-policy.js";
import {downloadFilename} from "./download-filename.js";
import {shouldExposeTask3Diagnostics} from "./diagnostics.js";
import {readSb3File} from "./import-file.js";
import {
  loadScratchGui,
  setGuiLoadingVisible,
} from "./load-scratch-gui.js";
import {
  setGuiSplashProgress,
  setGuiSplashVisible,
} from "./gui-splash.js";
import {loadRecordSafely} from "./load-record.js";
import {applyGuestInitialProject} from "./guest-project-apply.js";
import {applyRemoteProjectUpdate} from "./apply-remote-update.js";
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
import {
  cancelScratchBlockGesture,
  isScratchBlockInteractionActive,
} from "./block-interaction.js";
import {summarizePreflightIssues} from "@blocksync/collaboration-domain";
import {
  activateTabAction,
  BLOCKS_TAB_INDEX,
  captureLocalEditorUiState,
  readActiveTabIndex,
  readWorkspaceViewport,
  seedViewportForRuntimeTarget,
  UPDATE_METRICS_TYPE,
  viewportForTargetSelection,
  type GuiStoreLike,
  type WorkspaceViewport,
} from "./local-editor-ui-state.js";
import {createLocalViewportMemory} from "./local-viewport-memory.js";
import {
  captureEditingSelection,
  loadProjectPreservingEditingTarget,
  type EditingSelectionRef,
  type EditingTargetLike,
} from "./load-project-preserving-editing-target.js";
import {
  applyViewportToScratchWorkspace,
  isInternalMetricsEcho,
  readWorkspaceViewportFromScratch,
  resolveScratchWorkspace,
} from "./scratch-workspace.js";
import {resolveCollabSignalingUrl} from "./signaling-url.js";
import {
  AI_CHAT_ADVICE_MAX_TOKENS,
  AI_CHAT_PROXY_PATH,
  buildAdviceMessages,
  buildAiProjectContext,
  buildContinuationUserPrompt,
  formatAiAnswerHtml,
  formatQuestionTargetLabel,
  hasActiveConversation,
  loadAiAssistSettings,
  looksTruncatedAiAnswer,
  mergeAiAnswerContinuation,
  resolveAdviceMode,
  resolveAiAssistConfig,
  resolveQuestionTargetName,
  requestAiChat,
  saveAiAssistSettings,
  type AiAdviceMode,
  type AiAssistSettings,
  type AiClarifyChoice,
  type AiClarifyPrompt,
  type AiChatMessage,
  type AiConversationTurn,
} from "@blocksync/ai-assist";
import {
  aiModeOptionsForLevel,
  aiPanelHidden,
  aiQuestionTargetHint,
  aiQuestionTargetOptions,
  aiStatusSummary,
  buildClarifyGenerationMessages,
  buildFallbackClarifyPrompt,
  buildOtherClarifyChoice,
  formatClarifiedIntentLabel,
  friendlyAiError,
  levelSelectOptions,
  listAiConversationPages,
  needsIntentClarification,
  parseClarifyResponse,
  pickAiQuestionTargetValue,
  providerSelectOptions,
  readSettingsFromForm,
} from "./ai-assist-ui.js";

type ProjectDocument = LocalProjectRecord["document"];

interface EditorGuiState {
  store: GuiStoreLike;
  dispatch(action: unknown): unknown;
}

interface VmBlocks {
  createBlock(block: Record<string, unknown>): void;
  getBlock(id: string): unknown;
}

interface ScratchVm {
  attachStorage(storage: ScratchStorageInstance): void;
  loadProject(project: unknown): Promise<void>;
  setEditingTarget(targetId: string): void;
  editingTarget?: {
    id?: string;
    isStage?: boolean;
    getName?: () => string;
    sprite?: {name?: string};
  } | null;
  toJSON(): string;
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string): void;
  runtime: {
    storage?: ScratchStorageInstance;
    targets: Array<{
      id: string;
      isStage: boolean;
      isOriginal?: boolean;
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
    ): Promise<unknown> | null;
  }): void;
}

interface ScratchGuiGlobal {
  ScratchStorage: new () => ScratchStorageInstance;
  EditorState: new (options: {isEmbedded?: boolean; locale?: string}) => EditorGuiState;
  createStandaloneRoot(
    state: EditorGuiState,
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
const statusIconRow = requiredElement<HTMLElement>("status-icon-row");
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
const collabFeedback = requiredElement<HTMLElement>("collab-feedback");
const aiEnabledInput = requiredElement<HTMLInputElement>("ai-enabled");
const aiApiKeyInput = requiredElement<HTMLInputElement>("ai-api-key");
const aiProviderSelect = requiredElement<HTMLSelectElement>("ai-provider");
const aiLevelSelect = requiredElement<HTMLSelectElement>("ai-level");
const aiModelOverrideInput = requiredElement<HTMLInputElement>("ai-model-override");
const aiSettingsSaveButton = requiredElement<HTMLButtonElement>("ai-settings-save");
const aiSettingsClearKeyButton =
  requiredElement<HTMLButtonElement>("ai-settings-clear-key");
const aiSettingsStatus = requiredElement<HTMLElement>("ai-settings-status");
const aiSettingsFeedback = requiredElement<HTMLElement>("ai-settings-feedback");
const aiPanel = requiredElement<HTMLDetailsElement>("ai-panel");
const aiQuestionTargetSelect = requiredElement<HTMLSelectElement>(
  "ai-question-target",
);
const aiQuestionTargetHintEl = requiredElement<HTMLElement>(
  "ai-question-target-hint",
);
const aiModeSelect = requiredElement<HTMLSelectElement>("ai-mode");
const aiQuestionInput = requiredElement<HTMLTextAreaElement>("ai-question");
const aiAskButton = requiredElement<HTMLButtonElement>("ai-ask");
const aiClearChatButton = requiredElement<HTMLButtonElement>("ai-clear-chat");
const aiRuntimeStatus = requiredElement<HTMLElement>("ai-runtime-status");
const aiClarify = requiredElement<HTMLElement>("ai-clarify");
const aiClarifyPromptEl = requiredElement<HTMLElement>("ai-clarify-prompt");
const aiClarifyChoices = requiredElement<HTMLElement>("ai-clarify-choices");
const aiClarifyOther = requiredElement<HTMLElement>("ai-clarify-other");
const aiClarifyOtherInput = requiredElement<HTMLTextAreaElement>(
  "ai-clarify-other-input",
);
const aiClarifyOtherSubmit = requiredElement<HTMLButtonElement>(
  "ai-clarify-other-submit",
);
const aiAnswerPager = requiredElement<HTMLElement>("ai-answer-pager");
const aiPagePrevButton = requiredElement<HTMLButtonElement>("ai-page-prev");
const aiPageNextButton = requiredElement<HTMLButtonElement>("ai-page-next");
const aiPageStatus = requiredElement<HTMLElement>("ai-page-status");
const aiThread = requiredElement<HTMLElement>("ai-thread");
const aiAnswer = requiredElement<HTMLElement>("ai-answer");
const aiFeedback = requiredElement<HTMLElement>("ai-feedback");
const guiHost = requiredElement<HTMLElement>("scratch-gui");
const guiSplash = document.querySelector<HTMLElement>("#gui-splash");
const chromeLeft = document.querySelector<HTMLElement>(".chrome-left");
if (chromeLeft) {
  installSyncratchChromeLayout({chromeLeft, guiHost});
}
const toolPanels = [
  ...document.querySelectorAll<HTMLDetailsElement>(".tool-panel"),
];

for (const panel of toolPanels) {
  panel.addEventListener("toggle", () => {
    if (!panel.open) return;
    for (const other of toolPanels) {
      if (other !== panel) other.open = false;
    }
  });
}

document.addEventListener("pointerdown", event => {
  if (!shouldCloseToolPanelsOnOutsideTarget(event.target, toolPanels)) return;
  closeOpenToolPanels(toolPanels);
});

document.addEventListener("keydown", event => {
  if (!shouldCloseToolPanelsOnKey(event.key)) return;
  closeOpenToolPanels(toolPanels);
});

function closePanelFor(element: HTMLElement): void {
  const panel = element.closest<HTMLDetailsElement>(".tool-panel");
  if (panel) panel.open = false;
}

let store: ProjectStore;
let vm: ScratchVm;
let editorGuiState: EditorGuiState | null = null;
/** Per local-project + stable document-target viewport memory (local-only). */
const viewportMemory = createLocalViewportMemory();
let uiRestoreEpoch = 0;
/** Runtime id whose Redux metrics are considered synced from per-target memory. */
let lastSyncedEditingTargetId: string | null = null;
/**
 * Brief sync window while we seed metrics before Scratch listeners run. Not a
 * timed "trusted wins over user pan" guard.
 */
let suppressViewportMemoryCapture = false;
/** Last UPDATE_METRICS we dispatched; ignore that exact echo for one epoch. */
let pendingInternalMetricsSeed: {
  epoch: number;
  targetId: string;
  viewport: WorkspaceViewport;
} | null = null;
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
let driveOverwriteConfirmationRequired = false;
let lastCollabState: CollabState | null = null;
let lastCollabIdleMessage = "ひとりで作っています";
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
  createTestBlockOnTarget(id: string, targetName: string): void {
    const target = vm.runtime.targets.find(
      candidate => !candidate.isStage && candidate.getName() === targetName,
    );
    if (!target) throw new Error(`Sprite target missing: ${targetName}`);
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
  hasBlockOnTarget(id: string, targetName: string): boolean {
    const target = vm.runtime.targets.find(
      candidate => !candidate.isStage && candidate.getName() === targetName,
    );
    const block = target?.blocks.getBlock(id);
    return block !== null && block !== undefined;
  },
  selectTargetByName(targetName: string): boolean {
    const target = vm.runtime.targets.find(
      candidate => candidate.getName() === targetName,
    );
    if (!target) return false;
    bumpUiRestoreEpoch();
    // Seed per-target memory under the new runtime id *before* setEditingTarget
    // so Scratch workspaceUpdate cannot copy the previous sprite's scroll.
    syncEditingTargetViewportFromMemory(target);
    vm.setEditingTarget(target.id);
    return true;
  },
  editingTargetName(): string | null {
    const editing = vm.editingTarget;
    if (!editing) return null;
    if (typeof editing.getName === "function") return editing.getName() ?? null;
    return editing.sprite?.name ?? null;
  },
  getLocalEditorUiState() {
    if (!editorGuiState || !hasCurrent) return null;
    const selection = captureEditingSelection(
      vm.editingTarget,
      current.document,
    );
    return captureLocalEditorUiState(
      editorGuiState.store,
      vm.editingTarget?.id,
      readToolboxCategoryId(),
      viewportMemory.get(
        current.localProjectId,
        selection?.documentId ?? null,
      ),
      {preferRemembered: suppressViewportMemoryCapture},
    );
  },
  getReduxWorkspaceViewport() {
    if (!editorGuiState || !vm?.editingTarget?.id) return null;
    return readWorkspaceViewport(editorGuiState.store, vm.editingTarget.id);
  },
  getLiveWorkspaceViewport() {
    return readLiveWorkspaceViewport();
  },
  setActiveEditorTab(activeTabIndex: number): void {
    if (!editorGuiState) throw new Error("Editor GUI store missing");
    bumpUiRestoreEpoch();
    editorGuiState.dispatch(activateTabAction(activeTabIndex));
  },
  setWorkspaceViewport(scrollX: number, scrollY: number, scale: number): boolean {
    if (!editorGuiState || !hasCurrent) return false;
    const targetId = vm.editingTarget?.id;
    if (!targetId) return false;
    // Cancel target-switch settle so it cannot revive a pre-pan viewport.
    const epoch = bumpUiRestoreEpoch();
    lastSyncedEditingTargetId = targetId;
    const viewport = {scrollX, scrollY, scale};
    const selection = captureEditingSelection(
      vm.editingTarget,
      current.document,
    );
    suppressViewportMemoryCapture = true;
    rememberViewportForSelection(selection, viewport);
    dispatchInternalViewportMetrics(targetId, viewport);
    applyWorkspaceViewport(viewport);
    scheduleViewportMemorySettle(targetId, selection, viewport, epoch);
    const stored = viewportMemory.get(
      current.localProjectId,
      selection?.documentId ?? null,
    );
    return Boolean(
      stored &&
        stored.scrollX === scrollX &&
        stored.scrollY === scrollY &&
        stored.scale === scale,
    );
  },
  selectToolboxCategory(categoryId: string): boolean {
    return restoreToolboxCategory(categoryId);
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

/** Mutable map shared with the memory helper so CDN stores stay attached. */
const collabMemoryAssets = new Map<string, Uint8Array>();
let collabMemoryHelperAttached = false;

function attachLocalStorage(record: LocalProjectRecord): void {
  collabMemoryAssets.clear();
  for (const [md5ext, bytes] of assetMap(record)) {
    if (bytes.byteLength > 0) collabMemoryAssets.set(md5ext, bytes);
  }
  const runtimeStorage = vm.runtime.storage as ScratchStorageInstance | undefined;
  if (runtimeStorage && collabMemoryHelperAttached) {
    return;
  }
  // Prefer the GUI/CDN-backed store when present; only create a bare store as
  // a fallback so library costume fetches remain available after collab apply.
  const storage = runtimeStorage ?? new GUI.ScratchStorage();
  storage.addHelper({
    load: createMemoryAssetLoader(storage, collabMemoryAssets),
  });
  collabMemoryHelperAttached = true;
  if (!runtimeStorage) {
    vm.attachStorage(storage);
  }
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
  const {primary, details, icons} = composeProjectStatusView({
    local: lastLocalSaveState,
    drive: lastDriveStatus,
    driveMessage: lastDriveMessage,
    collab: lastCollabState,
    collabIdleMessage: lastCollabIdleMessage,
    fatalError: fatalBootError,
    localError: localOperationError,
  });
  // Visible UI is icon-first; full sentences stay in sr-only nodes for a11y/e2e.
  renderStatusIconRow(statusIconRow, icons);
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

const signalingUrl = resolveCollabSignalingUrl(
  import.meta.env.VITE_COLLAB_SIGNALING_URL,
);

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

/** Prevents renderDriveStatus → renderCollabIdle → renderDriveStatus loops. */
let syncingDriveControlsFromCollab = false;

function refreshDriveControlsForCollab(): void {
  syncingDriveControlsFromCollab = true;
  try {
    renderDriveStatus(lastDriveStatus, lastDriveMessage);
  } finally {
    syncingDriveControlsFromCollab = false;
  }
}

function renderCollabIdle(message = "ひとりで作っています"): void {
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
  // Leaving a guest room must re-enable Drive controls.
  refreshDriveControlsForCollab();
}

function renderCollabState(state: CollabState): void {
  lastCollabState = state;
  if (state.bootstrapPhase === "ready") {
    guestInitialRollback = null;
  }
  collabStatus.textContent = collaborationStatusText(state);
  driveAutosave?.eligibilityChanged();
  createRoomButton.disabled = true;
  joinRoomButton.disabled = true;
  copyInviteButton.disabled = activeInvite === null;
  leaveRoomButton.disabled = false;
  renderBootstrapActions(state);
  renderProjectStatus();
  refreshDriveControlsForCollab();
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
      title: context.projectTitle ?? DEFAULT_GUEST_COLLAB_TITLE,
      revision: 0,
      updatedAt: new Date().toISOString(),
      document,
      assets: assetRecordsFromMap(document, assets),
      saveState: "clean",
    };
    clearLocalUiMemoryForProjectReplacement();
    const applied = await applyGuestInitialProject({
      candidate: record,
      previous,
      isActive: () =>
        generation === collaborationGeneration && collabSession !== null,
      async load(recordToLoad) {
        attachLocalStorage(recordToLoad);
        // Guest-initial is a different project copy — do not restore the
        // previous work's selected sprite onto the newly received project.
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

  const previous = structuredClone(current);
  let next: LocalProjectRecord;
  try {
    next = {
      ...current,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      document,
      assets: assetRecordsFromMap(document, assets),
      saveState: "clean",
    };
  } catch (error) {
    // Missing costume/sound bytes: still cannot safely materialize a record,
    // but do not leave the peer stuck — surface save error and abort apply.
    if (isMissingAssetError(error)) {
      renderSaveState("error");
      return false;
    }
    throw error;
  }

  const result = await applyRemoteProjectUpdate({
    candidate: next,
    previous,
    isActive: () =>
      generation === collaborationGeneration && collabSession !== null,
    async load(recordToLoad) {
      attachLocalStorage(recordToLoad);
      // Remote applies use full loadProject. Scratch regenerates runtime target
      // ids and forces editingTarget to the first sprite — remap selection via
      // stable ProjectDocument identity instead of the old runtime id.
      // If a Blockly gesture somehow remained open, cancel it before clear().
      cancelScratchBlockGesture(scratchWorkspace());
      await loadProjectPreservingEditingTarget(
        vm,
        documentToProjectJson(recordToLoad.document),
        {
          beforeDocument: previous.document,
          afterDocument: recordToLoad.document,
          localUi: editorGuiState
            ? {
                store: guiStoreTrackingInternalMetrics(editorGuiState.store),
                readToolboxCategoryId,
                restoreToolboxCategory,
                rememberedViewportForSelection: selection =>
                  hasCurrent
                    ? viewportMemory.get(
                        current.localProjectId,
                        selection?.documentId ?? null,
                      )
                    : null,
                rememberViewportForSelection,
                preferRememberedViewport: () => suppressViewportMemoryCapture,
                applyViewport: viewport => {
                  if (isScratchBlockInteractionActive(scratchWorkspace())) {
                    return;
                  }
                  applyWorkspaceViewport(viewport);
                },
                beginRestoreEpoch: bumpUiRestoreEpoch,
                isRestoreEpochCurrent: epoch => epoch === uiRestoreEpoch,
                currentRuntimeEditingTargetId: () => vm.editingTarget?.id,
              }
            : undefined,
        },
      );
    },
    persist: candidate => store.createOrReplace(candidate, previous.revision),
    commit(saved, {persisted}) {
      const session = projectSessions.begin();
      if (persisted) {
        current = saved;
      } else {
        // Keep remote document in memory but stay on the IDB revision so a
        // later retry can write without a stale-revision conflict.
        current = {
          ...saved,
          revision: previous.revision,
          saveState: "error",
        };
      }
      hasCurrent = true;
      titleInput.value = friendlyProjectTitle(current.title);
      installSaveCoordinator(session);
      renderSaveState(persisted ? "clean" : "error");
    },
    setSuppressed(value) {
      suppressVmChanges = value;
    },
    onPersistError() {
      // Status is set in commit({persisted:false}); keep for diagnostics.
    },
  });
  return result.applied;
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
    signalingTopic: topic,
    signalingUrl,
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
    isBlockInteractionActive: () =>
      isScratchBlockInteractionActive(scratchWorkspace()),
    cancelBlockInteraction: () => {
      cancelScratchBlockGesture(scratchWorkspace());
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
  collabFeedback.textContent = "";
  collabInviteInput.value = inviteUrl(window.location.href, invite);
  const started = session.start({host});
  if (!started.ok) {
    const summary = summarizePreflightIssues(started.issues);
    collabSession = null;
    activeInvite = null;
    renderCollabIdle(summary.summary);
    collabStatus.title = summary.codes.length > 0
      ? `${summary.codes.join(", ")} / 作品の素材や内容を確認してください。`
      : "作品の素材や内容を確認してください。";
  }
  closePanelFor(host ? createRoomButton : joinRoomButton);
}

async function createRoom(): Promise<void> {
  try {
    const readiness = evaluateCollabReadiness({signalingUrl});
    if (!readiness.ok) {
      renderCollabIdle(
        friendlyCollaborationMessage(readiness.reason) ??
          "いっしょに作る機能を使えません。",
      );
      return;
    }
    await startCollaboration(createInvite(), true);
  } catch {
    renderCollabIdle(
      "いっしょに作るリンクを作れませんでした。インターネットをたしかめてください。",
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
      renderCollabIdle(
        friendlyCollaborationMessage("Invalid collaboration invite")!,
      );
      return;
    }
    const readiness = evaluateCollabReadiness({signalingUrl});
    if (!readiness.ok) {
      renderCollabIdle(
        friendlyCollaborationMessage(readiness.reason) ??
          "いっしょに作る機能を使えません。",
      );
      return;
    }
    await startCollaboration(invite, false);
  } catch {
    renderCollabIdle(
      "友だちの作品に入れませんでした。リンクとインターネットをたしかめてください。",
    );
  }
}

function bumpUiRestoreEpoch(): number {
  uiRestoreEpoch += 1;
  // Cancelled settles must not leave the capture suppress latch stuck closed,
  // or real Blockly pan/zoom updates are ignored until the next successful settle.
  suppressViewportMemoryCapture = false;
  return uiRestoreEpoch;
}

function clearLocalUiMemoryForProjectReplacement(): void {
  bumpUiRestoreEpoch();
  viewportMemory.clearAll();
  lastSyncedEditingTargetId = null;
  suppressViewportMemoryCapture = false;
  pendingInternalMetricsSeed = null;
}

function rememberViewportForSelection(
  selection: EditingSelectionRef | null,
  viewport: WorkspaceViewport,
): void {
  if (!hasCurrent || !selection?.documentId) return;
  viewportMemory.set(
    current.localProjectId,
    selection.documentId,
    viewport,
  );
}

function noteInternalMetricsSeed(
  runtimeTargetId: string,
  viewport: WorkspaceViewport,
): void {
  pendingInternalMetricsSeed = {
    epoch: uiRestoreEpoch,
    targetId: runtimeTargetId,
    viewport: {...viewport},
  };
}

function dispatchInternalViewportMetrics(
  runtimeTargetId: string,
  viewport: WorkspaceViewport,
): void {
  if (!editorGuiState) return;
  noteInternalMetricsSeed(runtimeTargetId, viewport);
  seedViewportForRuntimeTarget(
    editorGuiState.store,
    runtimeTargetId,
    viewport,
  );
}

/** Store wrapper so loadProject seed dispatches are tracked as internal echoes. */
function guiStoreTrackingInternalMetrics(base: GuiStoreLike): GuiStoreLike {
  return {
    getState: () => base.getState(),
    subscribe: base.subscribe?.bind(base),
    dispatch(action: unknown) {
      if (action && typeof action === "object") {
        const metrics = action as {
          type?: string;
          targetID?: string;
          scrollX?: number;
          scrollY?: number;
          scale?: number;
        };
        if (
          metrics.type === UPDATE_METRICS_TYPE &&
          typeof metrics.targetID === "string" &&
          typeof metrics.scrollX === "number" &&
          typeof metrics.scrollY === "number" &&
          typeof metrics.scale === "number"
        ) {
          noteInternalMetricsSeed(metrics.targetID, {
            scrollX: metrics.scrollX,
            scrollY: metrics.scrollY,
            scale: metrics.scale,
          });
        }
      }
      return base.dispatch(action);
    },
  };
}

function scheduleViewportMemorySettle(
  runtimeTargetId: string,
  selection: EditingSelectionRef | null,
  viewport: WorkspaceViewport,
  epoch: number,
): void {
  const run = () => {
    try {
      if (epoch !== uiRestoreEpoch) return;
      if (vm?.editingTarget?.id !== runtimeTargetId) return;
      if (!editorGuiState) return;
      dispatchInternalViewportMetrics(runtimeTargetId, viewport);
      rememberViewportForSelection(selection, viewport);
      if (readActiveTabIndex(editorGuiState.store) === BLOCKS_TAB_INDEX) {
        applyWorkspaceViewport(viewport);
      }
    } catch {
      // Best-effort only.
    } finally {
      suppressViewportMemoryCapture = false;
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
}

/**
 * Apply per-target remembered viewport (or Scratch defaults) for the editing
 * sprite. Prevents Blockly's live workspace scroll from leaking across targets
 * when setEditingTarget regenerates / swaps metrics keys.
 */
function syncEditingTargetViewportFromMemory(
  editingTarget: EditingTargetLike | null | undefined = vm?.editingTarget,
): void {
  if (!editorGuiState || !hasCurrent || !editingTarget?.id) return;
  const selection = captureEditingSelection(editingTarget, current.document);
  const remembered = viewportMemory.get(
    current.localProjectId,
    selection?.documentId ?? null,
  );
  const viewport = viewportForTargetSelection(remembered);
  // Mark synced before dispatching so store subscribers / targetsUpdate cannot
  // re-enter and recurse while seeding metrics for this runtime id.
  lastSyncedEditingTargetId = editingTarget.id;
  suppressViewportMemoryCapture = true;
  dispatchInternalViewportMetrics(editingTarget.id, viewport);
  rememberViewportForSelection(selection, viewport);
  if (readActiveTabIndex(editorGuiState.store) === BLOCKS_TAB_INDEX) {
    applyWorkspaceViewport(viewport);
  }
  scheduleViewportMemorySettle(
    editingTarget.id,
    selection,
    viewport,
    uiRestoreEpoch,
  );
}

function noteEditingTargetMaybeChanged(): void {
  const editingId = vm?.editingTarget?.id ?? null;
  if (!editingId || !hasCurrent || !editorGuiState) return;
  if (editingId === lastSyncedEditingTargetId) return;
  if (suppressViewportMemoryCapture) return;
  bumpUiRestoreEpoch();
  syncEditingTargetViewportFromMemory(vm.editingTarget);
}

function leaveRoom(): void {
  driveAutosave?.cancel();
  // Invalidate pending UI settles before tearing down the session.
  bumpUiRestoreEpoch();
  pendingInternalMetricsSeed = null;
  // Leave before bumping generation so tentative guest-initial rollback can run.
  collabSession?.leave();
  collaborationGeneration += 1;
  collabSession = null;
  activeInvite = null;
  collabFeedback.textContent = "";
  renderCollabIdle();
}

async function loadRecord(
  record: LocalProjectRecord,
  signal?: AbortSignal,
): Promise<void> {
  driveAutosave?.cancel();
  clearLocalUiMemoryForProjectReplacement();
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
        titleInput.value = friendlyProjectTitle(loaded.title);
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
  title = "新しい作品",
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
    throw new Error(message || "Scratch の作品ファイルではありません");
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

function scratchWorkspace() {
  const blocksApi = (
    globalThis as unknown as {Blockly?: Parameters<typeof resolveScratchWorkspace>[1]}
  ).Blockly;
  return resolveScratchWorkspace(guiHost, blocksApi ?? null);
}

function readToolboxCategoryId(): string | null {
  try {
    const selected = scratchWorkspace()?.getToolbox?.()?.getSelectedItem?.();
    const id = selected?.getId?.();
    if (typeof id === "string" && id.length > 0) return id;
  } catch {
    // fall through to DOM
  }
  const selected = guiHost.querySelector(
    ".blocklyToolboxCategory.blocklyToolboxSelected, .scratchCategoryMenuItem.categorySelected",
  );
  const id = selected?.getAttribute("id") ?? selected?.getAttribute("data-category");
  return id && id.length > 0 ? id : null;
}

function restoreToolboxCategory(categoryId: string): boolean {
  try {
    const toolbox = scratchWorkspace()?.getToolbox?.();
    if (!toolbox) return false;
    if (typeof toolbox.getToolboxItemById === "function" &&
      typeof toolbox.setSelectedItem === "function") {
      const item = toolbox.getToolboxItemById(categoryId);
      if (item) {
        toolbox.setSelectedItem(item);
        return true;
      }
    }
    if (typeof toolbox.selectCategoryByName === "function") {
      toolbox.selectCategoryByName(categoryId);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function readLiveWorkspaceViewport(): WorkspaceViewport | null {
  return readWorkspaceViewportFromScratch(scratchWorkspace());
}

function applyWorkspaceViewport(viewport: {
  scrollX: number;
  scrollY: number;
  scale: number;
}): boolean {
  return applyViewportToScratchWorkspace(scratchWorkspace(), viewport);
}

async function getVm(): Promise<ScratchVm> {
  setGuiLoadingVisible(guiHost, true);
  setGuiSplashVisible(guiSplash, true);
  setGuiSplashProgress(guiSplash, {
    ratio: 0.14,
    label: "エディターを準備しています…",
  });
  saveStatus.textContent = "エディターを読み込み中…";
  await loadScratchGui();
  setGuiSplashProgress(guiSplash, {
    ratio: 0.62,
    label: "Scratch エディターを読み込んでいます…",
  });
  return new Promise(resolve => {
    // Full editor (not embedded/player-only) so students can edit blocks.
    // EditorState requires a params object — undefined crashes boot.
    // 日本語（漢字）。ひらがな版は "ja-Hira"。
    const state = new GUI.EditorState({locale: "ja"});
    editorGuiState = state;
    state.store.subscribe?.(() => {
      try {
        if (!hasCurrent || !vm?.editingTarget?.id) return;
        const editingId = vm.editingTarget.id;
        if (editingId !== lastSyncedEditingTargetId) {
          // GUI sprite click path: restore per-target memory before Redux
          // pollution from the previous workspace scroll is recorded.
          noteEditingTargetMaybeChanged();
          return;
        }
        if (suppressViewportMemoryCapture) return;
        // On the blocks tab Redux is authoritative, including intentional
        // returns to Scratch defaults. Off-tab rewrites are ignored here.
        if (readActiveTabIndex(state.store) !== BLOCKS_TAB_INDEX) return;
        const viewport = readWorkspaceViewport(state.store, editingId);
        if (!viewport) return;
        const selection = captureEditingSelection(
          vm.editingTarget,
          current.document,
        );
        if (
          isInternalMetricsEcho(pendingInternalMetricsSeed, {
            epoch: uiRestoreEpoch,
            targetId: editingId,
            viewport,
          })
        ) {
          // Exact echo of our seed — keep memory aligned, do not cancel settle.
          rememberViewportForSelection(selection, viewport);
          pendingInternalMetricsSeed = null;
          return;
        }
        // Real Blockly pan/zoom (or any non-echo metrics): adopt immediately
        // and invalidate pending restore settles so the user always wins.
        bumpUiRestoreEpoch();
        pendingInternalMetricsSeed = null;
        rememberViewportForSelection(selection, viewport);
      } catch {
        // ignore store subscription failures
      }
    });
    setGuiSplashProgress(guiSplash, {
      ratio: 0.86,
      label: "作品スペースを組み立てています…",
    });
    const root = GUI.createStandaloneRoot(state, guiHost);
    installScratchAccessibility(guiHost);
    root.render({
      canEditTitle: false,
      canSave: false,
      onVmInit: vmInstance => {
        setGuiSplashProgress(guiSplash, {
          ratio: 1,
          label: "もうすぐ始まります…",
        });
        setGuiLoadingVisible(guiHost, false);
        setGuiSplashVisible(guiSplash, false);
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

function renderDriveStatus(
  status: EditorDriveStatus,
  message?: string,
): void {
  const previousStatus = lastDriveStatus;
  const conflictAction = driveConflictAction(status);
  if (
    conflictAction === "clear" &&
    shouldLatchDriveOverwriteConfirmation(previousStatus, status)
  ) {
    driveOverwriteConfirmationRequired = true;
  }
  if (status === "synced") {
    driveOverwriteConfirmationRequired = false;
  }

  const detailMessage = message ?? (
    driveOverwriteConfirmationRequired &&
      (status === "connected" || status === "unsynced")
      ? DRIVE_OVERWRITE_CONFIRMATION_REASON
      : undefined
  );
  const friendlyMessage = friendlyDriveMessage(detailMessage);
  lastDriveStatus = status;
  lastDriveMessage = friendlyMessage;
  const collabGuest = Boolean(
    collabSession && !collabSession.createdThisRoom(),
  );
  const controls = driveControlFlags({
    driveReady,
    status,
    collabGuest,
  });
  if (controls.guestDriveBlocked) {
    driveStatus.textContent = GUEST_DRIVE_SAVE_BLOCKED_STATUS;
    driveStatus.title = GUEST_DRIVE_SAVE_BLOCKED_STATUS;
  } else {
    driveStatus.textContent = friendlyMessage
      ? `${drivePanelStatusText[status]}：${friendlyMessage}`
      : drivePanelStatusText[status];
    driveStatus.title = friendlyMessage ?? "";
  }
  connectGoogleButton.disabled = controls.connectDisabled;
  openDriveButton.disabled = controls.openDisabled;
  // Host: keep Save enabled during conflict for explicit retry after re-baseline.
  // Guest: always disabled — only the invite creator may write Drive.
  saveDriveButton.disabled = controls.saveDisabled;
  disconnectGoogleButton.disabled = controls.disconnectDisabled;
  if (conflictAction === "report") collabSession?.reportDriveConflict();
  if (conflictAction === "clear") collabSession?.clearDriveConflict();
  if (!collabSession && !syncingDriveControlsFromCollab) {
    renderCollabIdle(lastCollabIdleMessage);
  } else {
    renderProjectStatus();
  }
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

async function setupDriveIntegration(): Promise<EditorDriveIntegration> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY?.trim() ?? "";
  const appId = import.meta.env.VITE_GOOGLE_APP_ID?.trim() ?? "";
  const configured = Boolean(clientId && apiKey && appId);
  const scripts = loadGoogleScripts();
  // Prefer collab-host authorization-code + refresh-token sessions when the
  // same-origin OAuth endpoints are configured; otherwise keep GIS token client.
  const hostOAuthAvailable = configured
    ? await probeHostDriveOAuthAvailable()
    : false;
  const auth: GoogleAuthorization = hostOAuthAvailable
    ? createHostBackedGoogleAuthorization()
    : createGoogleAuthorization({
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
    canPersistToDrive: options => {
      const base = collabSession?.canPersistToDrive(options) ?? {ok: true};
      if (!base.ok) return base;
      if (
        driveOverwriteConfirmationRequired &&
        options?.explicit !== true
      ) {
        return {
          ok: false,
          reason: DRIVE_OVERWRITE_CONFIRMATION_REASON,
        };
      }
      return base;
    },
  });
}

async function boot(): Promise<void> {
  // Overlap IndexedDB open with the large Scratch GUI download.
  const guiReady = getVm();
  store = await openProjectStore();
  vm = await guiReady;
  vm.on("PROJECT_CHANGED", markDirty);
  vm.on("targetsUpdate", () => {
    noteEditingTargetMaybeChanged();
  });
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
  consumeDriveOAuthReturnFlag();
  renderDriveStatus(driveIntegration.getStatus());
  await driveIntegration.tryRestoreSession();
  const fragmentInvite = decodeInviteFragment(window.location.hash);
  if (fragmentInvite) {
    // Opening a shared invite URL should join immediately; the input is also
    // filled so the guest can copy/rejoin after leave.
    collabInviteInput.value = window.location.href;
    renderCollabIdle();
    await startCollaboration(fragmentInvite, false);
    return;
  }
  renderCollabIdle();
}

driveIntegration = await setupDriveIntegration();
driveAutosave = createDriveAutosave({
  delayMs: 2_000,
  isEligible: () => {
    const state = collabSession?.getState();
    return hasCurrent &&
      !driveOverwriteConfirmationRequired &&
      isDriveAutosaveEligible({
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
    localOperationError =
      "作品ファイルを開けませんでした。今の作品はそのままです。";
    renderProjectStatus();
    retryButton.hidden = true;
  } finally {
    fileInput.value = "";
    closePanelFor(openButton);
  }
});
downloadButton.addEventListener("click", () => {
  void exportCurrentSb3().then(download);
  closePanelFor(downloadButton);
});
saveButton.addEventListener("click", () => {
  void saveCoordinator.flush();
  closePanelFor(saveButton);
});
retryButton.addEventListener("click", () => void saveCoordinator.flush());
connectGoogleButton.addEventListener("click", () => {
  void driveIntegration.connect().finally(() => {
    closePanelFor(connectGoogleButton);
  });
});
openDriveButton.addEventListener("click", () => {
  void driveIntegration.openFromDrive().finally(() => {
    closePanelFor(openDriveButton);
  });
});
saveDriveButton.addEventListener("click", () => {
  driveAutosave.cancel();
  if (driveOverwriteConfirmationRequired) {
    const confirmed = window.confirm(
      "Google ドライブの作品とちがうかもしれません。このパソコンの内容で上書きしますか？",
    );
    if (!confirmed) return;
    // Latch clears only after a successful synced status update.
  }
  void driveIntegration.saveToDrive({explicit: true}).finally(() => {
    closePanelFor(saveDriveButton);
  });
});
disconnectGoogleButton.addEventListener("click", () => {
  driveAutosave.cancel();
  if (shouldLeaveCollaborationOnGoogleDisconnect()) {
    leaveRoom();
  }
  driveIntegration.disconnect();
  closePanelFor(disconnectGoogleButton);
});
function releaseStuckBlockGesture(): void {
  cancelScratchBlockGesture(scratchWorkspace());
}

// Belt-and-suspenders for orphaned Blockly document listeners (stuck drag).
window.addEventListener("blur", releaseStuckBlockGesture);
window.addEventListener("pagehide", releaseStuckBlockGesture);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseStuckBlockGesture();
});

createRoomButton.addEventListener("click", () => void createRoom());
joinRoomButton.addEventListener("click", () => void joinRoom());
copyInviteButton.addEventListener("click", () => {
  if (!activeInvite) return;
  void navigator.clipboard
    .writeText(inviteUrl(window.location.href, activeInvite))
    .then(() => {
      collabFeedback.textContent =
        "コピーしました。いっしょに作りたい友だちに送ってね。";
    })
    .catch(() => {
      collabFeedback.textContent =
        "コピーできませんでした。リンクを選んでコピーしてください。";
    });
});
leaveRoomButton.addEventListener("click", () => {
  leaveRoom();
  closePanelFor(leaveRoomButton);
});
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
    collabFeedback.textContent = "くわしい情報をコピーしました。";
  });
});

/* -------------------------------------------------------------------------- */
/* AI advice assist — isolated from collab / Drive / local save paths.         */
/* Settings live in localStorage only (never Y.Doc / .sb3 / signaling).        */
/* -------------------------------------------------------------------------- */

let aiSettings: AiAssistSettings = loadAiAssistSettings(
  typeof localStorage === "undefined" ? null : localStorage,
);
let aiAskInFlight = false;
/** In-memory advice thread for this editor session (not persisted). */
let aiConversation: AiConversationTurn[] = [];
let aiSessionIntent: AiClarifyChoice | null = null;
/** Which Q&A pair is visible (0-based). */
let aiConversationPage = 0;

function fillAiLevelSelect(): void {
  aiLevelSelect.replaceChildren();
  for (const option of levelSelectOptions()) {
    const el = document.createElement("option");
    el.value = String(option.value);
    el.textContent = option.label;
    aiLevelSelect.append(el);
  }
}

function fillAiProviderSelect(): void {
  aiProviderSelect.replaceChildren();
  for (const option of providerSelectOptions()) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    aiProviderSelect.append(el);
  }
}

function fillAiModeSelect(settings: AiAssistSettings): void {
  const previous = aiModeSelect.value as AiAdviceMode;
  aiModeSelect.replaceChildren();
  for (const option of aiModeOptionsForLevel(settings.level)) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    aiModeSelect.append(el);
  }
  if ([...aiModeSelect.options].some(opt => opt.value === previous)) {
    aiModeSelect.value = previous;
  }
}

function readEditingTargetName(): string | null {
  if (!vm?.editingTarget) return null;
  const editing = vm.editingTarget;
  if (typeof editing.getName === "function") {
    return editing.getName() ?? null;
  }
  return editing.sprite?.name ?? null;
}

function readProjectJsonForAi(): Parameters<typeof buildAiProjectContext>[0] | null {
  if (!vm) return null;
  try {
    return JSON.parse(vm.toJSON()) as Parameters<typeof buildAiProjectContext>[0];
  } catch {
    return null;
  }
}

function fillAiQuestionTargetSelect(): void {
  const previous = aiQuestionTargetSelect.value;
  const projectJson = readProjectJsonForAi();
  const options = aiQuestionTargetOptions(projectJson);
  aiQuestionTargetSelect.replaceChildren();
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    aiQuestionTargetSelect.append(el);
  }
  aiQuestionTargetSelect.value = pickAiQuestionTargetValue({
    previousValue: previous,
    availableValues: options.map(option => option.value),
    editingTargetName: readEditingTargetName(),
  });
  aiQuestionTargetHintEl.textContent = aiQuestionTargetHint(
    aiQuestionTargetSelect.value,
  );
}

function applyAiSettingsToForm(settings: AiAssistSettings): void {
  aiEnabledInput.checked = settings.enabled;
  aiApiKeyInput.value = settings.apiKey;
  aiProviderSelect.value = settings.providerOverride;
  aiLevelSelect.value = String(settings.level);
  aiModelOverrideInput.value = settings.modelOverride;
}

function appendAiThreadTurn(turn: AiConversationTurn): void {
  const wrap = document.createElement("div");
  wrap.className =
    turn.role === "user"
      ? "ai-thread-turn ai-thread-turn-user"
      : "ai-thread-turn ai-thread-turn-assistant";
  const role = document.createElement("p");
  role.className = "ai-thread-role";
  role.textContent = turn.role === "user" ? "きみ" : "AI";
  wrap.append(role);
  if (turn.role === "assistant") {
    const body = document.createElement("div");
    body.innerHTML = formatAiAnswerHtml(turn.content);
    wrap.append(body);
  } else {
    const body = document.createElement("p");
    body.className = "ai-answer-text";
    body.textContent = turn.content;
    wrap.append(body);
  }
  aiThread.append(wrap);
}

function renderAiConversationThread(options?: {jumpToLatest?: boolean}): void {
  const pages = listAiConversationPages(aiConversation);
  aiThread.replaceChildren();
  aiAnswer.hidden = true;
  aiAnswer.innerHTML = "";

  if (pages.length === 0) {
    aiAnswerPager.hidden = true;
    aiPageStatus.textContent = "0 / 0";
    aiPagePrevButton.disabled = true;
    aiPageNextButton.disabled = true;
    return;
  }

  if (options?.jumpToLatest) {
    aiConversationPage = pages.length - 1;
  }
  aiConversationPage = Math.max(
    0,
    Math.min(aiConversationPage, pages.length - 1),
  );

  const [userTurn, assistantTurn] = pages[aiConversationPage]!;
  appendAiThreadTurn(userTurn);
  appendAiThreadTurn(assistantTurn);

  aiAnswerPager.hidden = false;
  aiPageStatus.textContent = `${aiConversationPage + 1} / ${pages.length}`;
  aiPagePrevButton.disabled = aiConversationPage <= 0;
  aiPageNextButton.disabled = aiConversationPage >= pages.length - 1;
}

function syncAiAskChrome(): void {
  const active = hasActiveConversation(aiConversation);
  aiClearChatButton.hidden = !active;
  aiAskButton.textContent = active ? "つづけてきく" : "AI にきく";
  aiQuestionInput.placeholder = active
    ? "例: やってみたけど、うまくいかなかった"
    : "例: このスプライトが動かないのはなぜ？";
  aiQuestionInput.rows = active ? 2 : 3;
  aiPanel.classList.toggle("ai-panel--answering", active);
}

function clearAiConversation(): void {
  aiConversation = [];
  aiSessionIntent = null;
  aiConversationPage = 0;
  hideAiClarify();
  renderAiConversationThread();
  aiFeedback.textContent = "";
  syncAiAskChrome();
  aiRuntimeStatus.textContent = aiStatusSummary(resolveAiAssistConfig(aiSettings));
}

function renderAiUi(settings: AiAssistSettings = aiSettings): void {
  const config = resolveAiAssistConfig(settings);
  const summary = aiStatusSummary(config);
  aiSettingsStatus.textContent = summary;
  if (!hasActiveConversation(aiConversation) && !aiAskInFlight) {
    aiRuntimeStatus.textContent = summary;
  }
  const hidden = aiPanelHidden(settings);
  aiPanel.hidden = hidden;
  if (hidden) {
    aiPanel.open = false;
    clearAiConversation();
  }
  fillAiModeSelect(settings);
  fillAiQuestionTargetSelect();
  aiAskButton.disabled = aiAskInFlight || !config.ready;
  aiClearChatButton.disabled = aiAskInFlight;
  syncAiAskChrome();
}

function persistAiSettingsFromForm(): AiAssistSettings {
  const next = readSettingsFromForm({
    enabled: aiEnabledInput.checked,
    apiKey: aiApiKeyInput.value,
    level: aiLevelSelect.value,
    modelOverride: aiModelOverrideInput.value,
    providerOverride: aiProviderSelect.value,
  });
  aiSettings = saveAiAssistSettings(
    typeof localStorage === "undefined" ? null : localStorage,
    next,
  );
  applyAiSettingsToForm(aiSettings);
  renderAiUi(aiSettings);
  const config = resolveAiAssistConfig(aiSettings);
  aiSettingsFeedback.textContent = config.ready
    ? `保存しました（${config.providerLabel} / ${config.model}）`
    : `保存しました。${config.notReadyReason ?? ""}`;
  return aiSettings;
}

fillAiProviderSelect();
fillAiLevelSelect();
applyAiSettingsToForm(aiSettings);
renderAiUi(aiSettings);

aiSettingsSaveButton.addEventListener("click", () => {
  persistAiSettingsFromForm();
});
aiSettingsClearKeyButton.addEventListener("click", () => {
  aiApiKeyInput.value = "";
  persistAiSettingsFromForm();
  aiSettingsFeedback.textContent = "API キーを消しました。";
});
aiEnabledInput.addEventListener("change", () => {
  persistAiSettingsFromForm();
});
aiProviderSelect.addEventListener("change", () => {
  persistAiSettingsFromForm();
});
aiLevelSelect.addEventListener("change", () => {
  persistAiSettingsFromForm();
});

aiQuestionTargetSelect.addEventListener("change", () => {
  aiQuestionTargetHintEl.textContent = aiQuestionTargetHint(
    aiQuestionTargetSelect.value,
  );
});

aiPanel.addEventListener("toggle", () => {
  if (aiPanel.open) fillAiQuestionTargetSelect();
});

function hideAiClarify(): void {
  aiClarify.hidden = true;
  aiClarifyChoices.replaceChildren();
  aiClarifyOther.hidden = true;
  aiClarifyOtherInput.value = "";
}

function renderAiClarifyPrompt(clarify: AiClarifyPrompt): void {
  aiClarifyPromptEl.textContent = clarify.promptText;
  aiClarifyChoices.replaceChildren();
  for (const choice of clarify.choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice.label;
    button.dataset.choiceId = choice.id;
    button.addEventListener("click", () => {
      hideAiClarify();
      void askAiWithIntent(choice);
    });
    aiClarifyChoices.append(button);
  }
  if (clarify.allowOther) {
    const otherButton = document.createElement("button");
    otherButton.type = "button";
    otherButton.textContent = "D: そのほか（じぶんでかく）";
    otherButton.addEventListener("click", () => {
      aiClarifyOther.hidden = false;
      aiClarifyOtherInput.focus();
    });
    aiClarifyChoices.append(otherButton);
  }
  aiClarifyOther.hidden = true;
  aiClarify.hidden = false;
  aiRuntimeStatus.textContent = "したいことを えらんでね";
}

async function showAiClarify(question: string): Promise<void> {
  const config = resolveAiAssistConfig(aiSettings);
  if (!config.ready || !config.model) {
    aiFeedback.textContent =
      config.notReadyReason ?? "AI の準備ができていません。";
    return;
  }

  fillAiQuestionTargetSelect();
  let projectSummary: string | null = null;
  try {
    const projectJson = readProjectJsonForAi();
    if (projectJson) {
      projectSummary = buildAiProjectContext(projectJson, {
        title: titleInput.value,
        editingTargetName: readEditingTargetName(),
        questionTargetName: aiQuestionTargetSelect.value,
      }).summaryText;
    }
  } catch {
    projectSummary = null;
  }

  aiAskInFlight = true;
  renderAiUi(aiSettings);
  hideAiClarify();
  aiRuntimeStatus.textContent = "したいことの 選択肢を 考えています…";
  try {
    const result = await requestAiChat({
      provider: config.provider,
      model: config.model,
      apiKey: aiSettings.apiKey,
      messages: buildClarifyGenerationMessages({
        question,
        projectSummary,
      }),
      proxyUrl: AI_CHAT_PROXY_PATH,
      maxTokens: 512,
      temperature: 0.4,
    });
    const parsed = parseClarifyResponse(result.content, question);
    renderAiClarifyPrompt(parsed ?? buildFallbackClarifyPrompt(question));
  } catch {
    renderAiClarifyPrompt(buildFallbackClarifyPrompt(question));
    aiFeedback.textContent =
      "選択肢をつくるのがうまくいかなかったので、かわりの選択肢を出しました。";
  } finally {
    aiAskInFlight = false;
    renderAiUi(aiSettings);
  }
}

async function askAiWithIntent(
  clarifiedIntent: AiClarifyChoice | null,
): Promise<void> {
  const config = resolveAiAssistConfig(aiSettings);
  aiFeedback.textContent = "";
  if (!config.ready || !config.model) {
    aiFeedback.textContent =
      config.notReadyReason ?? "AI の準備ができていません。";
    return;
  }
  const question = aiQuestionInput.value.trim();
  if (!question) {
    aiFeedback.textContent = friendlyAiError("empty question");
    return;
  }

  if (clarifiedIntent) {
    aiSessionIntent = clarifiedIntent;
  }
  const intentForPrompt = aiSessionIntent;

  fillAiQuestionTargetSelect();
  const questionTargetValue = aiQuestionTargetSelect.value;
  const questionTargetName = resolveQuestionTargetName(questionTargetValue);
  const targetLabel = formatQuestionTargetLabel(questionTargetName);
  const intentLabel = intentForPrompt
    ? formatClarifiedIntentLabel(intentForPrompt)
    : null;
  const continuing = hasActiveConversation(aiConversation);

  let projectContext = null;
  try {
    const projectJson = readProjectJsonForAi();
    if (projectJson) {
      projectContext = buildAiProjectContext(projectJson, {
        title: titleInput.value,
        editingTargetName: readEditingTargetName(),
        questionTargetName: questionTargetValue,
      });
    }
  } catch {
    projectContext = null;
  }

  const selectedMode = (aiModeSelect.value || "hint") as AiAdviceMode;
  const mode = resolveAdviceMode(selectedMode, question);
  let messages;
  try {
    messages = buildAdviceMessages({
      level: aiSettings.level,
      mode,
      userQuestion: question,
      project: projectContext,
      clarifiedIntent: intentForPrompt,
      conversationHistory: aiConversation,
    });
  } catch (error) {
    aiFeedback.textContent = friendlyAiError(
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  aiAskInFlight = true;
  renderAiUi(aiSettings);
  aiRuntimeStatus.textContent = continuing
    ? `${targetLabel} の つづきをきいています…`
    : intentLabel
      ? `${targetLabel} / ${intentLabel} についてAIにきいています…`
      : `${targetLabel} についてAIにきいています…`;
  try {
    const result = await requestAiChat({
      provider: config.provider,
      model: config.model,
      apiKey: aiSettings.apiKey,
      messages,
      proxyUrl: AI_CHAT_PROXY_PATH,
      maxTokens: AI_CHAT_ADVICE_MAX_TOKENS,
    });
    let answerContent = result.content;
    if (looksTruncatedAiAnswer(answerContent)) {
      aiRuntimeStatus.textContent = "こたえが途中だったので、続きをとりにいっています…";
      const continuationMessages: AiChatMessage[] = [
        ...messages,
        {role: "assistant", content: answerContent},
        {role: "user", content: buildContinuationUserPrompt()},
      ];
      try {
        const continuation = await requestAiChat({
          provider: config.provider,
          model: config.model,
          apiKey: aiSettings.apiKey,
          messages: continuationMessages,
          proxyUrl: AI_CHAT_PROXY_PATH,
          maxTokens: AI_CHAT_ADVICE_MAX_TOKENS,
        });
        answerContent = mergeAiAnswerContinuation(
          answerContent,
          continuation.content,
        );
      } catch {
        // Keep the partial answer if continuation fails.
      }
    }
    const userTurnText = intentLabel && !continuing
      ? `${question}\n（したいこと: ${intentLabel}）`
      : question;
    aiConversation = [
      ...aiConversation,
      {role: "user", content: userTurnText},
      {role: "assistant", content: answerContent},
    ];
    renderAiConversationThread({jumpToLatest: true});
    aiQuestionInput.value = "";
    aiFeedback.textContent = looksTruncatedAiAnswer(answerContent)
      ? "こたえが途中で止まっているみたい。もういちど「つづけてきく」をおしてみてね。"
      : "";
    const modeNote = mode !== selectedMode ? `（${mode}で診断）` : "";
    aiRuntimeStatus.textContent = continuing
      ? `${targetLabel} の つづきに ${config.providerLabel} / ${result.model} が答えました${modeNote}`
      : intentLabel
        ? `${targetLabel} / ${intentLabel} について ${config.providerLabel} / ${result.model} が答えました${modeNote}`
        : `${targetLabel} について ${config.providerLabel} / ${result.model} が答えました${modeNote}`;
  } catch (error) {
    aiFeedback.textContent = friendlyAiError(
      error instanceof Error ? error.message : String(error),
    );
    aiRuntimeStatus.textContent = aiStatusSummary(config);
  } finally {
    aiAskInFlight = false;
    renderAiUi(aiSettings);
  }
}

aiAskButton.addEventListener("click", () => {
  const config = resolveAiAssistConfig(aiSettings);
  aiFeedback.textContent = "";
  if (!config.ready || !config.model) {
    aiFeedback.textContent =
      config.notReadyReason ?? "AI の準備ができていません。";
    return;
  }
  const question = aiQuestionInput.value.trim();
  if (!question) {
    aiFeedback.textContent = friendlyAiError("empty question");
    return;
  }
  // Continuing a thread: skip clarify and keep prior intent/history.
  if (hasActiveConversation(aiConversation)) {
    hideAiClarify();
    void askAiWithIntent(aiSessionIntent);
    return;
  }
  if (needsIntentClarification(question)) {
    void showAiClarify(question);
    return;
  }
  hideAiClarify();
  void askAiWithIntent(null);
});

aiClearChatButton.addEventListener("click", () => {
  clearAiConversation();
  aiFeedback.textContent = "あたらしいはなしを はじめます";
});

aiPagePrevButton.addEventListener("click", () => {
  if (aiConversationPage <= 0) return;
  aiConversationPage -= 1;
  renderAiConversationThread();
});

aiPageNextButton.addEventListener("click", () => {
  const pages = listAiConversationPages(aiConversation);
  if (aiConversationPage >= pages.length - 1) return;
  aiConversationPage += 1;
  renderAiConversationThread();
});

aiClarifyOtherSubmit.addEventListener("click", () => {
  const other = aiClarifyOtherInput.value.trim();
  if (!other) {
    aiFeedback.textContent = "したいことを みじかく かいてね";
    return;
  }
  hideAiClarify();
  void askAiWithIntent(buildOtherClarifyChoice(other));
});

boot().catch(error => {
  diagnostic.error = error instanceof Error ? error.message : String(error);
  fatalBootError =
    "エディターを始められませんでした。ページを読み直してください。";
  setGuiSplashVisible(guiSplash, true);
  setGuiSplashProgress(guiSplash, {
    ratio: 1,
    label: "エディターを始められませんでした。ページを読み直してください。",
  });
  driveReady = false;
  renderDriveStatus(driveIntegration.getStatus());
});
