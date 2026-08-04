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
  fetchGoogleUserProfile,
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
  isCollabPresenceToggleTarget,
  renderCollabPresencePopover,
  setCollabPresencePopoverOpen,
  toggleCollabPresencePopover,
} from "./collab-presence-ui.js";
import {
  loadLocalCollabProfile,
  resolveAdvertisedCollabProfile,
  saveLocalCollabProfile,
} from "./local-collab-profile.js";
import {
  COLLAB_GOOGLE_CONNECT_HINT,
  COLLAB_GOOGLE_OAUTH_FAILED,
  COLLAB_GOOGLE_REQUIRED_FOR_CREATE,
  COLLAB_GOOGLE_REQUIRED_FOR_JOIN,
  consumePendingGuestInvite,
  consumePendingHostCreate,
  ensureInviteHashOnLocation,
  markPendingHostCreate,
  peekPendingGuestInvite,
  peekPendingHostCreate,
  savePendingGuestInvite,
  shouldGateCollabOnGoogle,
} from "./collab-oauth-gate.js";
import {
  CLASSROOM_DRIVE_BLOCKED_STATUS,
  drivePanelStatusText,
  friendlyCollaborationMessage,
  friendlyDriveMessage,
  INVITE_LINK_COPIED_TOAST,
  INVITE_LINK_COPY_FAILED_TOAST,
} from "./ui-copy.js";
import {createEphemeralToast} from "./ephemeral-toast.js";
import {
  DEFAULT_GUEST_COLLAB_TITLE,
  friendlyProjectTitle,
} from "./project-title.js";
import {installScratchAccessibility} from "./scratch-accessibility.js";
import {installFlyoutLayout} from "./flyout-layout.js";
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
import {setMenuButtonLabel} from "./menu-button-label.js";
import {installAiFloatingPanel} from "./ai-floating-panel.js";
import {createDiagnosticController} from "./diagnostic-controller.js";
import {renderDiagnosticView} from "./diagnostic-ui.js";
import {captureLiveProjectSnapshot} from "./live-project-snapshot.js";
import {installSyncratchChromeLayout} from "./unified-chrome.js";
import {
  closeExtensionLibraryAction,
  isExtensionLibraryOpen,
  type ExtensionVm,
} from "./extension-gallery.js";
import {createExtensionGalleryUi} from "./extension-gallery-ui.js";
import {
  ensureExtensionInToolbox,
  type ScratchBlocksLike,
} from "./extension-toolbox.js";
import {
  listLocales,
  localeLabel,
  readColorMode,
  readLocale,
  readRestoreDeletion,
  readTurboMode,
  selectLocale,
  setColorMode,
  toggleTurboMode,
} from "./scratch-native-menus.js";
import {
  canRedoBlocks,
  canUndoBlocks,
  captureUndoBeforeTargetSwitch,
  configureBlockWorkspaceUndo,
  createDeletionStackState,
  deletionButtonLabel,
  deletionStackDepth,
  installPerTargetUndoKeepAlive,
  noteRestoreDeletionCandidate,
  peekDeletion,
  popAndRestoreDeletion,
  redoBlocks,
  snapshotTargetUndo,
  undoBlocks,
  type BlockWorkspaceLike,
  type TargetUndoStacks,
} from "./edit-history.js";
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
import {scratchGuiBasePath} from "./gui-public-path.js";
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
import {persistDriveFileIdAndSyncCurrent, clearDriveFileIdAndSyncCurrent} from "./drive-file-current.js";
import {prepareCommittedDriveExport} from "./drive-export.js";
import {
  createInvite,
  decodeInviteFragment,
  deriveSignalingTopic,
  inviteUrl,
  parseInviteFromUrl,
  type CollabInvite,
} from "@blocksync/collab-invite";
import {createCollabProvider, createMemoryMesh, createWebRtcProvider} from "@blocksync/collab-webrtc";
import {
  parseCollabIceServers,
  resolveCollabIceServers,
} from "./collab-ice-servers.js";
import {
  createCollabSession,
  evaluateCollabReadiness,
  type ApplyRemoteContext,
  type CollabProviderConfig,
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
  resolveScratchBlocksApi,
  resolveScratchWorkspace,
} from "./scratch-workspace.js";
import {installProjectExtensionLoader} from "./extension-project-load.js";
import {ensureTurbowarpVmCompat} from "./turbowarp-vm-compat.js";
import {
  guardGlowUpdates,
  installExecutionControl,
  type ExecutionController,
} from "./execution-control.js";
import {reconcileEmptyWorkspaceWithVm} from "./workspace-run-guard.js";
import {
  getWorkspaceVmDesyncLog,
  type BlocklyWorkspaceLike,
  type VmBlockLike,
} from "./workspace-desync-diagnostics.js";
import {
  getE2eSideEffectCounters,
  recordE2eCollabOutbound,
  recordE2ePersistAttempt,
  resetE2eSideEffectCounters,
} from "./e2e-side-effect-counters.js";
import {
  getActiveLoadKind,
  getLoadBoundaryLog,
  getLoadEpoch,
  getSuppressedDirtyLog,
  getWorkspaceUpdateLog,
  installWorkspaceUpdateListener,
  recordLoadBoundaryTransition,
  recordSuppressedProjectChanged,
  type LoadBoundaryKind,
} from "./workspace-update-instrumentation.js";
import {
  getBlocklyEventLog,
  getBlocklyVmGraphDiffLog,
  getSyncGeneration as readSyncGeneration,
  installBlocklyVmEventPipeline,
  isBlocklyVmEventPipelineInstalled,
  isGraphMutatingBlocklyEvent,
  rebindWorkspaceBlockListener,
  type BlockEventDropKind,
  type BlocklyEventLike,
} from "./blockly-vm-event-instrumentation.js";
import {
  armBlockEventDropNext,
  armBlockEventDropAll,
  disarmBlockEventDrop,
  getBlockEventDropLog,
  logBlockEventDrop,
  peekArmedBlockEventDrop,
} from "./blockly-event-drop-harness.js";
import {
  installExecutionTrace,
  resolveTraceEntries,
  type ExecutionTraceHandle,
} from "./execution-trace.js";
import {
  createRewindOrigin,
  installExecutionRewind,
  type ExecutionRewindHandle,
  type RewindClearReason,
  type RewindOrigin,
  type RewindSnapshot,
} from "./execution-rewind.js";
import {installDebugFloatingPanel} from "./debug-floating-panel.js";
import {
  formatRewindButtonLabel,
  formatRewindButtonTitle,
  formatScrubSliderAriaValueText,
  formatScrubSliderLabel,
  shouldNotifyRewindUnavailable,
} from "./execution-rewind-ui.js";
import {createTraceListView} from "./execution-trace-ui.js";
import {
  filterEntriesByScript,
  listTraceScripts,
  resolveSelectedScriptKey,
} from "./execution-trace-scripts.js";
import {resolveCollabSignalingUrl} from "./signaling-url.js";
import {
  AI_CHAT_ADVICE_MAX_TOKENS,
  AI_CHAT_PROXY_PATH,
  DEFAULT_AI_SETTINGS,
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
import type {StudentPolicyView} from "@blocksync/classroom-access";
import {startAdminSurface} from "./admin-surface.js";
import {
  aiSettingsFromStudentPolicy,
  applyStudentPolicyToDom,
  isStudentDriveFullyBlocked,
  studentPolicyBlocksAiPersist,
} from "./classroom-policy-apply.js";
import {detectEditorSurfaceMode} from "./surface-mode.js";
import {
  hideStudentAuthShell,
  shouldShowStudentAuthGate,
  showStudentAuthShell,
} from "./student-auth-gate.js";
import {fetchStudentIdentitySession} from "./student-auth-ui.js";
import {
  hideStudentSubmissionUi,
  mountStudentSubmissionUi,
  showStudentSubmissionUi,
} from "./student-submission-ui.js";
import {
  exchangeStudentGrant,
  fetchStudentPolicyFromGrant,
  replaceStudentUrlWithoutToken,
  showStudentLinkError,
} from "./student-surface.js";
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
  /** Top-level script hat ids, when the live scratch-vm Blocks object is present. */
  getScripts?: () => string[];
  deleteAllBlocks?: () => void;
}

interface ScratchVm {
  attachStorage(storage: ScratchStorageInstance): void;
  loadProject(project: unknown): Promise<void>;
  setEditingTarget(targetId: string): void;
  setTurboMode(enabled: boolean): void;
  blockListener: (event: unknown) => void;
  editingTarget?: {
    id?: string;
    isStage?: boolean;
    getName?: () => string;
    sprite?: {name?: string};
  } | null;
  toJSON(): string;
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string): void;
  extensionManager: ExtensionVm["extensionManager"];
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
    stopForTarget?: (target: unknown) => void;
    stopAll?: () => void;
    threads?: unknown[];
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
      /** Absolute asset prefix for blocks-media (must not be route-relative "./"). */
      basePath?: string;
      canEditTitle: boolean;
      canSave: boolean;
      canManageFiles?: boolean;
      canChangeLanguage?: boolean;
      canChangeColorMode?: boolean;
      canChangeTheme?: boolean;
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
const execControlGroup = requiredElement<HTMLElement>("exec-control");
const tracePanelList = requiredElement<HTMLElement>("trace-list");
const traceClearButton = requiredElement<HTMLButtonElement>("trace-clear");
const traceScriptFilterWrap = requiredElement<HTMLElement>(
  "trace-script-filter-wrap",
);
const traceScriptFilter = requiredElement<HTMLSelectElement>(
  "trace-script-filter",
);
const execDebugToggleButton =
  requiredElement<HTMLButtonElement>("exec-debug-toggle");
const execDebugToggleLabel = requiredElement<HTMLElement>(
  "exec-debug-toggle-label",
);
const execDebugPauseResumeButton = requiredElement<HTMLButtonElement>(
  "exec-debug-pause-resume",
);
const execRewindButton = requiredElement<HTMLButtonElement>("exec-rewind");
const execRewindLabel = requiredElement<HTMLElement>("exec-rewind-label");
const execScrubInput = requiredElement<HTMLInputElement>("exec-scrub");
const execScrubLabel = requiredElement<HTMLElement>("exec-scrub-label");
const execStepButton = requiredElement<HTMLButtonElement>("exec-step");
const execStatus = requiredElement<HTMLElement>("exec-status");
const execDebugPanel = requiredElement<HTMLElement>("exec-debug-panel");
const execDebugDragHandle = requiredElement<HTMLElement>("exec-debug-drag-handle");
const execDebugCloseButton = requiredElement<HTMLButtonElement>("exec-debug-close");
const saveStatus = requiredElement<HTMLElement>("save-status");
const projectStatusDetails = requiredElement<HTMLElement>("project-status-details");
const statusIconRow = requiredElement<HTMLElement>("status-icon-row");
const collabPresencePopover = requiredElement<HTMLElement>(
  "collab-presence-popover",
);
const connectGoogleButton =
  requiredElement<HTMLButtonElement>("connect-google");
const openDriveButton = requiredElement<HTMLButtonElement>("open-drive");
const saveDriveButton = requiredElement<HTMLButtonElement>("save-drive");
const disconnectGoogleButton =
  requiredElement<HTMLButtonElement>("disconnect-google");
const driveStatus = requiredElement<HTMLElement>("drive-status");
const driveSectionHelp = requiredElement<HTMLElement>("drive-section-help");
const driveControls = requiredElement<HTMLElement>("drive-controls");
const createRoomButton = requiredElement<HTMLButtonElement>("create-room");
const joinRoomButton = requiredElement<HTMLButtonElement>("join-room");
const copyInviteButton = requiredElement<HTMLButtonElement>("copy-invite");
const collabReconnectButton = requiredElement<HTMLButtonElement>("collab-reconnect");
const collabRetrySaveButton = requiredElement<HTMLButtonElement>("collab-retry-save");
const collabDownloadSb3Button = requiredElement<HTMLButtonElement>("collab-download-sb3");
const collabDiagnosticsButton = requiredElement<HTMLButtonElement>("collab-diagnostics");
const collabInviteInput = requiredElement<HTMLInputElement>("collab-invite");
const collabStatus = requiredElement<HTMLElement>("collab-status");
const collabFeedback = requiredElement<HTMLElement>("collab-feedback");
const appToast = createEphemeralToast(requiredElement<HTMLElement>("app-toast"));
const scratchLocaleSelect = requiredElement<HTMLSelectElement>("scratch-locale");
const scratchColorModeSelect = requiredElement<HTMLSelectElement>(
  "scratch-color-mode",
);
const editUndoButton = requiredElement<HTMLButtonElement>("edit-undo");
const editRedoButton = requiredElement<HTMLButtonElement>("edit-redo");
const restoreDeletionButton = requiredElement<HTMLButtonElement>(
  "restore-deletion",
);
const toggleTurboButton = requiredElement<HTMLButtonElement>("toggle-turbo");
const editStatus = requiredElement<HTMLElement>("edit-status");
const COLLAB_CREATE_LABEL = "いっしょに作るリンクを作る";
const COLLAB_LEAVE_LABEL = "いっしょに作るのをやめる";
let deletionStackState = createDeletionStackState();
const targetUndoStacks: TargetUndoStacks = new Map();
let lastUndoTargetId: string | null = null;
let undoKeepAliveDispose: (() => void) | null = null;
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
const aiPanelContent = requiredElement<HTMLElement>("ai-panel-content");
const aiPanelDragHandle = requiredElement<HTMLElement>("ai-panel-drag-handle");
const aiPanelCloseButton = requiredElement<HTMLButtonElement>("ai-panel-close");
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
const diagnosticPanel = requiredElement<HTMLDetailsElement>("diagnostic-panel");
const diagnosticRunButton = requiredElement<HTMLButtonElement>("diagnostic-run");
const diagnosticStatus = requiredElement<HTMLElement>("diagnostic-status");
const diagnosticResults = requiredElement<HTMLElement>("diagnostic-results");
const diagnosticFeedback = requiredElement<HTMLElement>("diagnostic-feedback");
const guiHost = requiredElement<HTMLElement>("scratch-gui");
const guiSplash = document.querySelector<HTMLElement>("#gui-splash");
const appMain = document.querySelector<HTMLElement>("#app");
const adminShell = document.querySelector<HTMLElement>("#admin-shell");
const studentErrorShell = document.querySelector<HTMLElement>(
  "#student-error-shell",
);
const studentAuthShell = document.querySelector<HTMLElement>(
  "#student-auth-shell",
);
const studentSubmissionPanel = document.querySelector<HTMLElement>(
  "#student-submission-panel",
);
const SURFACE_MODE = detectEditorSurfaceMode();
// Pin before loadScratchGui / Blocks media resolve (nested /s/{token} routes).
(
  window as Window & {__BLOCKSYNC_GUI_PUBLIC_PATH__?: string}
).__BLOCKSYNC_GUI_PUBLIC_PATH__ = scratchGuiBasePath();
let studentPolicy: StudentPolicyView | null = null;
if (SURFACE_MODE.kind !== "community" && appMain) {
  appMain.hidden = true;
}
const chromeLeft = document.querySelector<HTMLElement>(".chrome-left");
if (chromeLeft && SURFACE_MODE.kind !== "admin") {
  installSyncratchChromeLayout({chromeLeft, guiHost});
}
const toolPanels = [
  ...document.querySelectorAll<HTMLDetailsElement>(".tool-panel"),
];
/** Dropdown menus dismiss on outside click; AI stays open as a floating dialog. */
const dismissibleToolPanels = toolPanels.filter(panel => panel !== aiPanel);

installAiFloatingPanel({
  panel: aiPanel,
  content: aiPanelContent,
  handle: aiPanelDragHandle,
  closeButton: aiPanelCloseButton,
});

for (const panel of toolPanels) {
  panel.addEventListener("toggle", () => {
    if (!panel.open) return;
    for (const other of toolPanels) {
      // Keep the AI ask dialog open while using other toolbar menus.
      if (other !== panel && other !== aiPanel) other.open = false;
    }
  });
}

document.addEventListener("pointerdown", event => {
  // Pausing or stepping in the debug panel must not close other toolbar menus.
  if (
    event.target instanceof Node &&
    (execControlGroup.contains(event.target) || execDebugPanel.contains(event.target))
  ) {
    return;
  }
  if (
    !shouldCloseToolPanelsOnOutsideTarget(event.target, dismissibleToolPanels)
  ) {
    return;
  }
  closeOpenToolPanels(dismissibleToolPanels);
  if (
    collabPresencePopover.classList.contains("is-open") &&
    event.target instanceof Node &&
    !collabPresencePopover.contains(event.target) &&
    !statusIconRow.contains(event.target)
  ) {
    setCollabPresencePopoverOpen(collabPresencePopover, false);
  }
});

document.addEventListener("keydown", event => {
  if (!shouldCloseToolPanelsOnKey(event.key)) return;
  closeOpenToolPanels(toolPanels);
  setCollabPresencePopoverOpen(collabPresencePopover, false);
});

statusIconRow.addEventListener("click", event => {
  if (!isCollabPresenceToggleTarget(event.target)) return;
  if (!lastCollabState || lastCollabState.status === "disconnected") return;
  syncCollabPresencePopover();
  toggleCollabPresencePopover(collabPresencePopover);
});

statusIconRow.addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!isCollabPresenceToggleTarget(event.target)) return;
  event.preventDefault();
  if (!lastCollabState || lastCollabState.status === "disconnected") return;
  syncCollabPresencePopover();
  toggleCollabPresencePopover(collabPresencePopover);
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

function readWorkspaceUpdateInstrumentationContext(): {
  suppressVmChanges: boolean;
  diagnosticReady: boolean;
  uiRestoreEpoch: number;
  collaborationGeneration: number;
  projectSessionId: number;
  saveDirtyGeneration: number;
  editingTarget: ScratchVm["editingTarget"] | null | undefined;
} {
  return {
    suppressVmChanges,
    diagnosticReady: diagnostic.ready,
    uiRestoreEpoch,
    collaborationGeneration,
    projectSessionId: projectSessions.getActive(),
    saveDirtyGeneration: saveCoordinator?.getDirtyGeneration?.() ?? 0,
    editingTarget: vm?.editingTarget ?? null,
  };
}

function readWorkspaceUpdateInstrumentationContextFull(): import("./workspace-update-instrumentation.js").WorkspaceUpdateInstrumentationContext {
  return {
    loadEpoch: getLoadEpoch(),
    loadKind: getActiveLoadKind(),
    ...readWorkspaceUpdateInstrumentationContext(),
  };
}

function readBlocklyVmEventContext(): import("./blockly-vm-event-instrumentation.js").BlocklyVmEventContext {
  return {
    loadEpoch: getLoadEpoch(),
    ...readWorkspaceUpdateInstrumentationContext(),
    editingTargetId: vm?.editingTarget?.id,
  };
}

function readE2eBlockEventDropDecision(): import("./blockly-vm-event-instrumentation.js").BlockEventDropDecision {
  const kind = peekArmedBlockEventDrop();
  if (!kind) return null;
  return {
    kind,
    logDrop: entry =>
      logBlockEventDrop({
        at: Date.now(),
        kind: entry.kind,
        event: entry.event,
        syncGeneration: entry.syncGeneration,
      }),
  };
}

function readBlocklyVmEditingTarget():
  | {
      blocks?: {
        getScripts?: () => string[];
        _blocks?: Record<string, VmBlockLike>;
      };
    }
  | null
  | undefined {
  return vm?.editingTarget as ScratchVm["editingTarget"] & {
    blocks?: {
      getScripts?: () => string[];
      _blocks?: Record<string, VmBlockLike>;
    };
  };
}

function ensureBlocklyVmEventPipeline(): void {
  if (!vm) return;
  if (!isBlocklyVmEventPipelineInstalled(vm)) {
    installBlocklyVmEventPipeline(
      vm,
      readBlocklyVmEventContext,
      blocklyWorkspace,
      readBlocklyVmEditingTarget,
      import.meta.env.MODE === "e2e"
        ? {readDropDecision: readE2eBlockEventDropDecision}
        : undefined,
    );
  }
  rebindWorkspaceBlockListener(blocklyWorkspace());
}

function setSuppressedVmChanges(kind: LoadBoundaryKind, value: boolean): void {
  recordLoadBoundaryTransition(
    kind,
    value,
    readWorkspaceUpdateInstrumentationContext(),
  );
  suppressVmChanges = value;
}
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
/** Friendly Japanese detail for status icons / titles. */
let lastDriveMessage: string | undefined;
/**
 * Raw English (or gate) detail from Drive integration. Must be kept separately
 * from `lastDriveMessage` — re-running friendlyDriveMessage on already-localized
 * text falls through to the generic "もう一度ためしてください" copy.
 */
let lastDriveRawMessage: string | undefined;
let driveOverwriteConfirmationRequired = false;
/** Google profile picture for the collab avatar chip; cleared on disconnect. */
let googleAvatarUrl: string | undefined;
let googleDisplayName: string | undefined;
let googleAvatarFetchGeneration = 0;
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
  workspaceVmDesyncLog() {
    return getWorkspaceVmDesyncLog();
  },
  workspaceUpdateLog() {
    return getWorkspaceUpdateLog();
  },
  loadBoundaryLog() {
    return getLoadBoundaryLog();
  },
  suppressedDirtyLog() {
    return getSuppressedDirtyLog();
  },
  blocklyEventLog() {
    return getBlocklyEventLog();
  },
  blocklyVmGraphDiffLog() {
    return getBlocklyVmGraphDiffLog();
  },
  getSyncGeneration() {
    return readSyncGeneration();
  },
  blockEventDropLog() {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("blockEventDropLog is available only in E2E mode");
    }
    return getBlockEventDropLog();
  },
  armDropNext(kind: BlockEventDropKind, count: number | "all" = 1) {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("armDropNext is available only in E2E mode");
    }
    if (count === "all") {
      armBlockEventDropAll(kind);
      return;
    }
    armBlockEventDropNext(kind, count);
  },
  disarmDrop() {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("disarmDrop is available only in E2E mode");
    }
    disarmBlockEventDrop();
  },
  resetE2eSideEffectCounters() {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("E2E side-effect counters are available only in E2E mode");
    }
    resetE2eSideEffectCounters();
  },
  getE2eSideEffectCounters() {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("E2E side-effect counters are available only in E2E mode");
    }
    return getE2eSideEffectCounters();
  },
  async reloadCurrentProject(): Promise<number> {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("reloadCurrentProject is available only in E2E mode");
    }
    if (!hasCurrent) throw new Error("No current project");
    const epochBefore = getLoadEpoch();
    await loadRecord(structuredClone(current));
    return epochBefore;
  },
  async installE2ePublishableCollabSession(): Promise<void> {
    await installE2ePublishableCollabSession();
  },
  async publishE2eCollabLocalChange(): Promise<void> {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("publishE2eCollabLocalChange is available only in E2E mode");
    }
    if (!collabSession) {
      throw new Error("No publishable collaboration session");
    }
    collabSession.noteLocalChange({force: true});
    await collabSession.flush();
  },
  async flushE2eLocalSave(): Promise<void> {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("flushE2eLocalSave is available only in E2E mode");
    }
    await saveCoordinator.flush();
  },
  getExecutionRewindSnapshot(): RewindSnapshot | null {
    if (import.meta.env.MODE !== "e2e") {
      throw new Error("getExecutionRewindSnapshot is available only in E2E mode");
    }
    return executionRewind?.getSnapshot() ?? null;
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

/** Restore execution rewind origin. Side-effect suppression is handled by replay lifecycle hooks. */
function localUiRestoreHooksForProjectLoad():
  | import("./load-project-preserving-editing-target.js").LocalUiRestoreHooks
  | undefined {
  if (!editorGuiState) return undefined;
  return {
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
      if (isScratchBlockInteractionActive(scratchWorkspace())) return;
      applyWorkspaceViewport(viewport);
    },
    beginRestoreEpoch: bumpUiRestoreEpoch,
    isRestoreEpochCurrent: epoch => epoch === uiRestoreEpoch,
    currentRuntimeEditingTargetId: () => vm.editingTarget?.id,
  };
}

async function loadVmProjectJson(
  projectJson: Record<string, unknown>,
): Promise<void> {
  const assets = runtimeAssetMap();
  const beforeDocument = documentFromVm(assets);
  const afterDocument = projectJsonToDocument(
    projectJson,
    assetHashCache.hashesFor(assets),
  );
  await loadProjectPreservingEditingTarget(vm, structuredClone(projectJson), {
    beforeDocument,
    afterDocument,
    localUi: localUiRestoreHooksForProjectLoad(),
  });
}

async function restoreRewindOrigin(origin: RewindOrigin): Promise<void> {
  if (origin.vmProjectJson !== undefined) {
    await loadVmProjectJson(
      structuredClone(origin.vmProjectJson) as Record<string, unknown>,
    );
    return;
  }
  await loadVmProjectJson(documentToProjectJson(origin.document));
}

async function restoreRewindExecutionCheckpoint(
  checkpoint: unknown,
): Promise<void> {
  if (!checkpoint || typeof checkpoint !== "object") {
    throw new Error("Execution checkpoint is unavailable");
  }
  vm.runtime.stopAll?.();
  await loadVmProjectJson(structuredClone(checkpoint) as Record<string, unknown>);
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
      if (import.meta.env.MODE === "e2e") {
        recordE2ePersistAttempt();
      }
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

let localCollabDisplayName =
  loadLocalCollabProfile()?.displayName ?? "";

function publishLocalCollabProfile(): void {
  const selfId =
    collabSession?.participantId() ??
    lastCollabState?.participants.find(p => p.isSelf)?.participantId ??
    "local";
  const advertised = resolveAdvertisedCollabProfile({
    participantId: selfId,
    googleDisplayName,
    googleAvatarUrl,
    localDisplayName: localCollabDisplayName,
  });
  collabSession?.setLocalProfile(advertised);
}

function saveLocalCollabDisplayName(rawName: string): void {
  const saved = saveLocalCollabProfile({displayName: rawName});
  localCollabDisplayName = saved?.displayName ?? "";
  publishLocalCollabProfile();
  renderProjectStatus();
  syncCollabPresencePopover();
}

function syncCollabPresencePopover(): void {
  const participants = lastCollabState?.participants ?? [];
  if (participants.length === 0) {
    setCollabPresencePopoverOpen(collabPresencePopover, false);
    collabPresencePopover.replaceChildren();
    return;
  }
  renderCollabPresencePopover(collabPresencePopover, participants, {
    localDisplayName: localCollabDisplayName,
    googleProfileActive: Boolean(googleAvatarUrl || googleDisplayName),
    onSaveLocalName: saveLocalCollabDisplayName,
  });
  if (!collabPresencePopover.classList.contains("is-open")) {
    collabPresencePopover.hidden = true;
  }
}

async function syncGoogleAvatarProfile(): Promise<void> {
  const token = driveIntegration.getAccessToken();
  if (!token) {
    googleAvatarFetchGeneration += 1;
    googleAvatarUrl = undefined;
    googleDisplayName = undefined;
    publishLocalCollabProfile();
    renderProjectStatus();
    return;
  }
  const generation = ++googleAvatarFetchGeneration;
  const profile = await fetchGoogleUserProfile(token);
  if (generation !== googleAvatarFetchGeneration) return;
  googleAvatarUrl = profile?.picture;
  googleDisplayName = profile?.name;
  publishLocalCollabProfile();
  renderProjectStatus();
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
    googleAvatarUrl,
  });
  // Visible UI is icon-first; full sentences stay in sr-only nodes for a11y/e2e.
  renderStatusIconRow(statusIconRow, icons);
  saveStatus.textContent = primary;
  saveStatus.title = fatalBootError ?? "";
  projectStatusDetails.textContent = details ? ` · ${details}` : "";
  projectStatusDetails.hidden = details.length === 0;
  syncCollabPresencePopover();
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
  if (suppressVmChanges) {
    recordSuppressedProjectChanged(readWorkspaceUpdateInstrumentationContext());
    return;
  }
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
const collabIceServers = parseCollabIceServers(
  import.meta.env.VITE_COLLAB_ICE_SERVERS,
);

function randomParticipantId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `p-${[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

let lastSurfacedCollabRecovery = false;

function renderBootstrapActions(state: CollabState | null): void {
  const phase = state?.bootstrapPhase ?? "idle";
  const iceStuckReceiving = Boolean(
    state &&
    !state.createdThisRoom &&
    (phase === "receiving-project" || phase === "verifying-project") &&
    state.signalingPeerCount > 0 &&
    state.peerCount === 0,
  );
  const needsRecovery = phase === "stalled-project" || iceStuckReceiving;
  collabReconnectButton.hidden = !needsRecovery;
  collabRetrySaveButton.hidden = phase !== "local-save-failed";
  collabDownloadSb3Button.hidden = phase !== "local-save-failed";
  collabDiagnosticsButton.hidden = !(
    phase === "stalled-project" ||
    phase === "invalid-project" ||
    phase === "local-save-failed" ||
    phase === "receiving-project" ||
    phase === "verifying-project"
  );
  // Surface recovery actions when receive stalls — don't leave guests stuck
  // looking only at the status chip.
  if (needsRecovery && !lastSurfacedCollabRecovery) {
    const collabPanel = document.querySelector<HTMLDetailsElement>(
      ".collab-panel",
    );
    if (collabPanel) collabPanel.open = true;
  }
  lastSurfacedCollabRecovery = needsRecovery;
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
    renderDriveStatus(lastDriveStatus, lastDriveRawMessage);
  } finally {
    syncingDriveControlsFromCollab = false;
  }
}

function syncCollabSessionToggleButton(ready: boolean): void {
  if (collabSession) {
    setMenuButtonLabel(createRoomButton, COLLAB_LEAVE_LABEL);
    createRoomButton.disabled = false;
    return;
  }
  setMenuButtonLabel(createRoomButton, COLLAB_CREATE_LABEL);
  createRoomButton.disabled = !ready;
}

function renderCollabIdle(message = "ひとりで作っています"): void {
  lastCollabState = null;
  lastCollabIdleMessage = message;
  setCollabPresencePopoverOpen(collabPresencePopover, false);
  collabStatus.textContent = message;
  const ready = hasCurrent && evaluateCollabReadiness({signalingUrl}).ok;
  syncCollabSessionToggleButton(ready);
  joinRoomButton.disabled = Boolean(collabSession) || !ready;
  copyInviteButton.disabled = activeInvite === null;
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
  syncCollabSessionToggleButton(true);
  joinRoomButton.disabled = true;
  copyInviteButton.disabled = activeInvite === null;
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
        setSuppressedVmChanges("guest", value);
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
      setSuppressedVmChanges("remote", value);
    },
    onPersistError() {
      // Status is set in commit({persisted:false}); keep for diagnostics.
    },
  });
  if (result.applied) {
    clearExecutionRewindHistory("remote-apply");
  }
  return result.applied;
}

async function installE2ePublishableCollabSession(): Promise<void> {
  if (import.meta.env.MODE !== "e2e") {
    throw new Error("E2E collab session helper is available only in E2E mode");
  }
  collabSession?.leave();
  const generation = ++collaborationGeneration;
  const mesh = createMemoryMesh();
  const session = createCollabSession({
    roomId: "e2e-workspace-side-effects",
    secret: "e2e-workspace-side-effects-secret-value",
    participantId: randomParticipantId(),
    debounceMs: 0,
    createProvider: (config: CollabProviderConfig) =>
      createCollabProvider({
        doc: config.doc,
        secret: config.secret,
        transport: mesh.createTransport(),
        participantId: config.participantId,
        applyRemoteUpdate: config.applyRemoteUpdate,
        isLocalOrigin: config.isLocalOrigin,
      }),
    materializeLocal: () => {
      const assets = runtimeAssetMap();
      return {document: documentFromVm(assets), assets};
    },
    applyRemoteToLocal: async () => true,
    onLocalPush: recordE2eCollabOutbound,
    onState: renderCollabState,
  });
  if (generation !== collaborationGeneration) return;
  const started = session.start({host: true});
  if (!started.ok) {
    throw new Error("Failed to start E2E publishable collab session");
  }
  collabSession = session;
  activeInvite = createInvite();
  await session.flush();
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
  const iceServers = await resolveCollabIceServers({
    envIceServers: collabIceServers,
    userId: participantId,
  });
  if (generation !== collaborationGeneration) return;
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
      iceServers,
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
    onLocalPush:
      import.meta.env.MODE === "e2e" ? recordE2eCollabOutbound : undefined,
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
  } else {
    publishLocalCollabProfile();
  }
  closePanelFor(host ? createRoomButton : joinRoomButton);
}

async function copyActiveInviteLink(options?: {
  /** Also mirror success/failure into the collab panel feedback line. */
  panelFeedback?: boolean;
}): Promise<boolean> {
  if (!activeInvite) return false;
  const url = inviteUrl(window.location.href, activeInvite);
  try {
    await navigator.clipboard.writeText(url);
    appToast.show(INVITE_LINK_COPIED_TOAST);
    if (options?.panelFeedback) {
      collabFeedback.textContent = INVITE_LINK_COPIED_TOAST;
    }
    return true;
  } catch {
    appToast.show(INVITE_LINK_COPY_FAILED_TOAST);
    if (options?.panelFeedback) {
      collabFeedback.textContent = INVITE_LINK_COPY_FAILED_TOAST;
    }
    return false;
  }
}

/**
 * Google OAuth (host-backed) full-page redirects kill WebRTC. Authenticate
 * before starting collaboration when Drive is configured.
 * Returns false if the user still needs to finish Google connect.
 */
async function ensureGoogleBeforeCollab(intent: {
  role: "host" | "guest";
  invite?: CollabInvite;
}): Promise<boolean> {
  if (!shouldGateCollabOnGoogle(driveIntegration.getStatus())) return true;
  if (driveIntegration.isConnected()) {
    // Already Google-connected (e.g. prior OAuth). Re-observe so a stale
    // "connected" status cannot hide local↔Drive drift, then push the host
    // baseline when still unsynced.
    if (intent.role === "host") {
      await driveIntegration.connect();
      await syncGoogleAvatarProfile();
      await pushHostDriveBaselineBeforeCollab();
    }
    return true;
  }

  if (intent.role === "host") {
    markPendingHostCreate();
    renderCollabIdle(COLLAB_GOOGLE_REQUIRED_FOR_CREATE);
  } else if (intent.invite) {
    ensureInviteHashOnLocation(intent.invite);
    savePendingGuestInvite(intent.invite);
    collabInviteInput.value = inviteUrl(window.location.href, intent.invite);
    renderCollabIdle(COLLAB_GOOGLE_REQUIRED_FOR_JOIN);
  }

  collabFeedback.textContent = COLLAB_GOOGLE_CONNECT_HINT;
  const connected = await driveIntegration.connect();
  await syncGoogleAvatarProfile();
  if (!connected && !driveIntegration.isConnected()) {
    if (intent.role === "host") {
      renderCollabIdle(COLLAB_GOOGLE_REQUIRED_FOR_CREATE);
    } else {
      renderCollabIdle(COLLAB_GOOGLE_REQUIRED_FOR_JOIN);
    }
    return false;
  }
  if (intent.role === "host") {
    await pushHostDriveBaselineBeforeCollab();
  }
  return true;
}

/**
 * Host "いっしょに作る" asserts the current local project as the shared source
 * of truth. If reconnect left Drive unsynced (local ≠ remote), push an
 * explicit save before the room opens so the host is not stuck on a diverge
 * banner with only a mislabeled secondary button.
 * Failure is non-fatal: local-first collab still starts; the Save CTA remains.
 */
async function pushHostDriveBaselineBeforeCollab(): Promise<void> {
  if (driveIntegration.getStatus() !== "unsynced") return;
  if (!driveIntegration.isConnected()) return;
  driveAutosave?.cancel();
  await driveIntegration.saveToDrive({explicit: true});
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
    if (!(await ensureGoogleBeforeCollab({role: "host"}))) return;
    // Clear stale pending flag if GIS/popup connected without navigation.
    consumePendingHostCreate();
    await startCollaboration(createInvite(), true);
    if (activeInvite) {
      // Do not put the invite hash on the host address bar — a reload would
      // auto-join as guest. Mid-session Google connect copies the hash first.
      await copyActiveInviteLink();
    }
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
    if (!(await ensureGoogleBeforeCollab({role: "guest", invite}))) return;
    consumePendingGuestInvite();
    await startCollaboration(invite, false);
    if (activeInvite) ensureInviteHashOnLocation(activeInvite);
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

function ensureBlockUndoKeepAlive(): void {
  const workspace = scratchWorkspace() as BlockWorkspaceLike | null;
  if (!workspace) return;
  configureBlockWorkspaceUndo(workspace);
  if (undoKeepAliveDispose) return;
  undoKeepAliveDispose = installPerTargetUndoKeepAlive({
    workspace,
    stacks: targetUndoStacks,
    getEditingTargetId: () => vm?.editingTarget?.id ?? null,
  });
  workspace.addChangeListener?.(() => {
    const editingId = vm?.editingTarget?.id ?? null;
    // Live snapshot so sprite-switch clearUndo cannot erase history.
    if (editingId) snapshotTargetUndo(targetUndoStacks, editingId, workspace);
    syncScratchNativeMenuControls();
  });
}

function noteEditingTargetMaybeChanged(): void {
  const editingId = vm?.editingTarget?.id ?? null;
  ensureBlocklyVmEventPipeline();
  ensureBlockUndoKeepAlive();
  // Best-effort capture if the previous sprite's stack is still present.
  lastUndoTargetId = captureUndoBeforeTargetSwitch({
    stacks: targetUndoStacks,
    workspace: scratchWorkspace() as BlockWorkspaceLike | null,
    previousTargetId: lastUndoTargetId,
    nextTargetId: editingId,
  });
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

function resetEditHistory(): void {
  deletionStackState = createDeletionStackState();
  targetUndoStacks.clear();
  lastUndoTargetId = null;
}

async function loadRecord(
  record: LocalProjectRecord,
  signal?: AbortSignal,
): Promise<void> {
  driveAutosave?.cancel();
  clearExecutionRewindHistory("project-load");
  clearLocalUiMemoryForProjectReplacement();
  resetEditHistory();
  const candidate = structuredClone(record);
  const previous = hasCurrent ? structuredClone(current) : undefined;
  const session = projectSessions.begin();
  saveCoordinator?.dispose();
  try {
    await loadRecordSafely({
      candidate,
      previous,
      setSuppressed(value) {
        setSuppressedVmChanges("load", value);
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

function blocklyWorkspace(): BlocklyWorkspaceLike | null {
  return scratchWorkspace() as BlocklyWorkspaceLike | null;
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
      // Absolute site root — not "./". Nested /s/{token} would break blocks-media.
      basePath: scratchGuiBasePath(),
      canEditTitle: false,
      canSave: false,
      // Syncratch owns 設定/ファイル/編集 menus (see feature-panels).
      canManageFiles: false,
      canChangeLanguage: false,
      canChangeColorMode: false,
      canChangeTheme: false,
      onVmInit: vmInstance => {
        // Warm TurboWarp compat while the default sprite/skins still exist.
        installBlocklyVmEventPipeline(
          vmInstance,
          readBlocklyVmEventContext,
          blocklyWorkspace,
          readBlocklyVmEditingTarget,
          import.meta.env.MODE === "e2e"
            ? {readDropDecision: readE2eBlockEventDropDecision}
            : undefined,
        );
        // loadProject() clears targets before reloading extensions, so Animated
        // Text needs cached Skin/RenderedTarget from this moment.
        ensureTurbowarpVmCompat(vmInstance);
        // Before any IndexedDB project restore: custom gallery extensions must
        // not go through the stock extension worker (that rejects and bricks boot).
        installProjectExtensionLoader(vmInstance, {
          onSkipped: (extensionIdOrUrl, error) => {
            const detail =
              error instanceof Error ? error.message : String(error);
            console.warn(
              `[syncratch] skipped extension during project load: ${extensionIdOrUrl}`,
              detail,
            );
          },
        });
        setGuiSplashProgress(guiSplash, {
          ratio: 1,
          label: "もうすぐ始まります…",
        });
        setGuiLoadingVisible(guiHost, false);
        setGuiSplashVisible(guiSplash, false);
        installExecutionControls(vmInstance);
        installScratchNativeMenus(state, vmInstance);
        installFlyoutLayout({
          root: guiHost,
          getWorkspace: () => scratchWorkspace(),
        });
        resolve(vmInstance);
      },
    });
  });
}

function fillScratchLocaleSelect(store: EditorGuiState["store"]): void {
  const current = readLocale(store);
  const locales = listLocales(store);
  scratchLocaleSelect.replaceChildren();
  for (const code of locales) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = localeLabel(code);
    scratchLocaleSelect.append(option);
  }
  scratchLocaleSelect.value = locales.includes(current)
    ? current
    : (locales[0] ?? "ja");
}

function syncScratchNativeMenuControls(): void {
  if (!editorGuiState) return;
  const store = editorGuiState.store;
  if (scratchLocaleSelect.options.length === 0) {
    fillScratchLocaleSelect(store);
  } else {
    const current = readLocale(store);
    if (
      [...scratchLocaleSelect.options].some(option => option.value === current)
    ) {
      scratchLocaleSelect.value = current;
    }
  }
  scratchColorModeSelect.value = readColorMode(store);

  deletionStackState = noteRestoreDeletionCandidate(
    deletionStackState,
    readRestoreDeletion(store),
  );
  const depth = deletionStackDepth(deletionStackState);
  const peek = peekDeletion(deletionStackState);
  restoreDeletionButton.disabled = depth === 0;
  setMenuButtonLabel(
    restoreDeletionButton,
    deletionButtonLabel(depth, peek?.deletedItem ?? ""),
  );

  ensureBlockUndoKeepAlive();
  const workspace = scratchWorkspace() as BlockWorkspaceLike | null;
  editUndoButton.disabled = !canUndoBlocks(workspace);
  editRedoButton.disabled = !canRedoBlocks(workspace);

  const turboOn = readTurboMode(store);
  setMenuButtonLabel(
    toggleTurboButton,
    turboOn ? "ターボモードを オフにする" : "ターボモードを オンにする",
  );
}

function installStudentExtensionBlock(state: EditorGuiState): void {
  let intercepting = false;
  state.store.subscribe?.(() => {
    if (intercepting) return;
    if (!isExtensionLibraryOpen(state.store.getState())) return;
    intercepting = true;
    try {
      state.store.dispatch(closeExtensionLibraryAction());
      appToast.show("このリンクでは拡張機能を追加できません");
    } finally {
      intercepting = false;
    }
  });
}

function installScratchNativeMenus(
  state: EditorGuiState,
  scratchVm: ScratchVm,
): void {
  fillScratchLocaleSelect(state.store);
  syncScratchNativeMenuControls();
  state.store.subscribe?.(() => {
    syncScratchNativeMenuControls();
  });
  ensureBlockUndoKeepAlive();
  const extensionsAllowed =
    !studentPolicy || studentPolicy.editor.allowExtensions;
  if (extensionsAllowed) {
    installDefaultExtensionGallery(state, scratchVm);
  } else {
    installStudentExtensionBlock(state);
  }
}

let executionController: ExecutionController | null = null;
let executionTrace: ExecutionTraceHandle | null = null;
let executionRewind: ExecutionRewindHandle | null = null;
let disposeDebugPanel: (() => void) | null = null;
let rewindInvalidationInstalled = false;
const traceListView = createTraceListView(tracePanelList);
/** User-picked script key; null means auto (most recently active). */
let selectedTraceScriptKey: string | null = null;
let traceScriptFilterUserPicked = false;

function clearExecutionRewindHistory(reason: RewindClearReason): void {
  executionRewind?.clearRewindHistory(reason);
}

function installRewindInvalidationListeners(): void {
  if (rewindInvalidationInstalled) return;
  const workspace = blocklyWorkspace();
  if (!workspace?.addChangeListener) return;
  workspace.addChangeListener((event: BlocklyEventLike) => {
    if (suppressVmChanges || getActiveLoadKind()) return;
    if (event.recordUndo === false) return;
    if (!isGraphMutatingBlocklyEvent(event)) return;
    clearExecutionRewindHistory("code-edit");
  });
  rewindInvalidationInstalled = true;
}

function syncTraceScriptFilter(
  scripts: ReturnType<typeof listTraceScripts>,
  selectedKey: string | null,
): void {
  const showFilter = scripts.length > 1;
  traceScriptFilterWrap.hidden = !showFilter;
  if (!showFilter) {
    traceScriptFilter.replaceChildren();
    return;
  }
  const previousFocus = document.activeElement === traceScriptFilter;
  traceScriptFilter.replaceChildren();
  for (const script of scripts) {
    const option = document.createElement("option");
    option.value = script.key;
    option.textContent = script.label;
    if (script.key === selectedKey) option.selected = true;
    traceScriptFilter.appendChild(option);
  }
  if (selectedKey) traceScriptFilter.value = selectedKey;
  if (previousFocus) traceScriptFilter.focus();
}

/**
 * Repaint the trace panel from the recorded entries.
 *
 * Only runs while the panel is open: a `forever` loop records constantly, and
 * rebuilding a list nobody is looking at would burn frames for nothing.
 *
 * When several hats have run, history is filtered to one script at a time
 * (selectable). A single hat-less stack run shows only that stack.
 */
function renderExecutionTrace(vmInstance: ScratchVm): void {
  if (!executionTrace) return;
  if (execDebugPanel.hidden) return;
  const targets = (vmInstance.runtime as {targets?: unknown[]} | undefined)
    ?.targets;
  const displayEntries = resolveTraceEntries(
    executionTrace.trace.getDisplayEntries(),
    (targets ?? []) as Parameters<typeof resolveTraceEntries>[1],
  );
  const scripts = listTraceScripts(displayEntries);
  const preferred = traceScriptFilterUserPicked ? selectedTraceScriptKey : null;
  const selectedKey = resolveSelectedScriptKey(scripts, preferred);
  if (traceScriptFilterUserPicked && preferred && selectedKey !== preferred) {
    // Cleared / truncated away — resume auto-follow of the latest script.
    traceScriptFilterUserPicked = false;
  }
  selectedTraceScriptKey = selectedKey;
  syncTraceScriptFilter(scripts, selectedKey);
  const visible =
    scripts.length > 1
      ? filterEntriesByScript(displayEntries, selectedKey)
      : displayEntries;
  traceListView.render(visible);
}

/** scratch-blocks builds this filter at inject time (src/glows.ts). */
const BLOCK_GLOW_FILTER = "url(#blocklyStackGlowFilter)";
let glowingBlockRoots: SVGElement[] = [];

/**
 * Paint "currently running" on specific blocks.
 *
 * Not via `runtime.glowBlock`: the GUI's BLOCK_GLOW_ON/OFF handlers are no-ops
 * in this scratch-gui, so that route lights nothing up. `glowStack` is the
 * script-level equivalent and throws for blocks that are not on the workspace,
 * so the filter is applied directly to the block's SVG root instead.
 */
function highlightExecutingBlocks(blockIds: string[]): void {
  for (const root of glowingBlockRoots) {
    root.removeAttribute("filter");
  }
  glowingBlockRoots = [];
  if (blockIds.length === 0) return;

  const workspace = scratchWorkspace() as {
    getBlockById?: (id: string) => {getSvgRoot?: () => SVGElement} | null;
  } | null;
  if (!workspace?.getBlockById) return;

  for (const id of blockIds) {
    const root = workspace.getBlockById(id)?.getSvgRoot?.();
    if (!root) continue;
    root.setAttribute("filter", BLOCK_GLOW_FILTER);
    glowingBlockRoots.push(root);
  }
}

/**
 * Wire the toolbar pause / step buttons to the VM.
 *
 * Kept best-effort: if the runtime shape ever stops matching, the editor must
 * still boot, so a failure here only hides the controls.
 */
function installExecutionControls(vmInstance: ScratchVm): void {
  executionController?.dispose();
  executionRewind?.dispose();
  executionTrace?.dispose();
  disposeDebugPanel?.();
  disposeDebugPanel = null;

  // Order matters. Both wrap Runtime._step, and the pause gate has to sit
  // OUTSIDE the recorder: gate -> recorder -> rewind -> real step. Installed
  // the other way round, the recorder still ran while execution was paused, so
  // pressing the green flag grew the history while the stage stayed frozen —
  // "the log moves but my sprite does not".
  executionTrace = installExecutionTrace(
    vmInstance as unknown as {runtime?: unknown},
  );

  let refreshExecUi: (() => void) | null = null;

  executionRewind = installExecutionRewind(
    vmInstance as unknown as {runtime?: unknown},
    {
      captureOrigin: () => {
        if (!hasCurrent) return null;
        const vmProjectJson = JSON.parse(vm.toJSON()) as Record<string, unknown>;
        return createRewindOrigin({
          document: documentFromVm(),
          assets: runtimeAssetMap(),
          projectSessionId: projectSessions.getActive(),
          runtime: vmInstance.runtime as import("./execution-rewind-fingerprint.js").RewindRuntimeLike,
          vmProjectJson,
        });
      },
      restoreOrigin: restoreRewindOrigin,
      captureExecutionCheckpoint: () => {
        if (!hasCurrent) return null;
        return JSON.parse(vm.toJSON()) as Record<string, unknown>;
      },
      restoreExecutionCheckpoint: restoreRewindExecutionCheckpoint,
      getTraceSize: () => executionTrace?.trace.size() ?? 0,
      onReplayLifecycle: phase => {
        setSuppressedVmChanges("rewind", phase === "start");
        executionTrace?.trace.setRecordingSuspended(phase === "start");
      },
      onTraceDisplayCursor: traceSize => {
        executionTrace?.trace.setDisplayCursor(traceSize);
        refreshExecUi?.();
      },
      onTraceTruncate: traceSize => {
        executionTrace?.trace.truncateTo(traceSize);
        executionTrace?.trace.setDisplayCursor(traceSize);
        refreshExecUi?.();
      },
      onHistoryCleared: reason => {
        if (reason !== "green-flag") {
          executionTrace?.trace.clear();
        }
        refreshExecUi?.();
      },
    },
  );

  // Independent of pause/step: a stale glow must not cancel the frame's draw.
  let loggedGlowFailure = false;
  guardGlowUpdates(
    (vmInstance as unknown as {runtime?: Record<string, unknown>}).runtime ?? {},
    error => {
      if (loggedGlowFailure) return;
      loggedGlowFailure = true;
      console.warn(
        "[syncratch] ブロックの光らせ方で失敗しました（描画は続けます）",
        error,
      );
    },
  );
  const controller = installExecutionControl(
    vmInstance as unknown as {runtime?: unknown},
    {highlight: highlightExecutingBlocks},
  );
  if (!controller) {
    execControlGroup.hidden = true;
    return;
  }
  executionController = controller;
  execControlGroup.hidden = false;

  let lastRewindSnapshot: RewindSnapshot | null = null;

  let scrubDebounceTimer: number | null = null;

  const updateScrubSliderFill = (input: HTMLInputElement): void => {
    const max = Number(input.max);
    const value = Number(input.value);
    const pct = max > 0 ? (value / max) * 100 : 0;
    input.style.setProperty("--scrub-progress", `${pct}%`);
  };

  const renderRewindControl = (): void => {
    const snapshot = executionRewind?.getSnapshot() ?? null;
    const paused = executionController?.getSnapshot().state === "paused";
    const canScrub = snapshot?.canScrub ?? false;
    const isReplaying = snapshot?.isReplaying ?? false;
    execRewindButton.disabled = !canScrub || isReplaying || (snapshot?.scrubDepthBack ?? 0) <= 0;
    const title = formatRewindButtonTitle(snapshot);
    execRewindButton.title = title;
    execRewindButton.setAttribute("aria-label", title);
    execRewindLabel.textContent = formatRewindButtonLabel(snapshot);

    const frontier = snapshot?.recordFrontierFrameIndex ?? -1;
    execScrubInput.min = "0";
    execScrubInput.max = String(Math.max(0, frontier));
    execScrubInput.value = String(snapshot?.playbackFrameIndex ?? 0);
    execScrubInput.disabled = !canScrub || isReplaying || !paused || frontier < 1;
    execScrubInput.setAttribute(
      "aria-valuetext",
      formatScrubSliderAriaValueText(snapshot),
    );
    execScrubLabel.textContent = formatScrubSliderLabel(snapshot);
    updateScrubSliderFill(execScrubInput);

    if (shouldNotifyRewindUnavailable(lastRewindSnapshot, snapshot)) {
      appToast.show(title);
    }
    lastRewindSnapshot = snapshot;
  };

  traceClearButton.addEventListener("click", () => {
    executionTrace?.trace.clear();
    selectedTraceScriptKey = null;
    traceScriptFilterUserPicked = false;
    renderExecutionTrace(vmInstance);
  });

  traceScriptFilter.addEventListener("change", () => {
    selectedTraceScriptKey = traceScriptFilter.value || null;
    traceScriptFilterUserPicked = true;
    renderExecutionTrace(vmInstance);
  });

  const debugPanel = installDebugFloatingPanel({
    panel: execDebugPanel,
    handle: execDebugDragHandle,
    closeButton: execDebugCloseButton,
  });
  disposeDebugPanel = () => debugPanel.dispose();

  const resumeExecution = (): void => {
    executionRewind?.commitPlaybackBranch();
    controller.resume();
  };

  const closeDebugPanelAndResume = (): void => {
    if (controller.getSnapshot().state === "paused") {
      resumeExecution();
    }
    debugPanel.setOpen(false);
    render();
  };

  const openDebugPanelAndPause = (): void => {
    if (controller.getSnapshot().state === "running") {
      controller.pause();
    }
    debugPanel.setOpen(true);
    render();
  };

  // While running, refresh trace (when open) and rewind availability on a timer.
  window.setInterval(() => {
    renderExecutionTrace(vmInstance);
    renderRewindControl();
  }, 700);

  const render = () => {
    const {state} = controller.getSnapshot();
    const paused = state === "paused";
    const panelOpen = debugPanel.isOpen();
    execControlGroup.dataset.state = state;

    execDebugToggleLabel.textContent = "デバッグ";
    execDebugToggleButton.setAttribute("aria-label", "デバッグ");
    execDebugToggleButton.title = "デバッグ";
    execDebugToggleButton.setAttribute(
      "aria-expanded",
      panelOpen ? "true" : "false",
    );

    const pauseResumeLabel = paused ? "再開" : "一時停止";
    execDebugPauseResumeButton.textContent = pauseResumeLabel;
    execDebugPauseResumeButton.setAttribute("aria-label", pauseResumeLabel);

    execStatus.textContent = paused ? "止まっています" : "動いています";
    renderExecutionTrace(vmInstance);
    renderRewindControl();
  };

  refreshExecUi = render;

  controller.subscribe(render);
  execDebugToggleButton.addEventListener("click", () => {
    if (debugPanel.isOpen()) {
      closeDebugPanelAndResume();
      return;
    }
    openDebugPanelAndPause();
  });
  execDebugCloseButton.addEventListener("click", () => {
    closeDebugPanelAndResume();
  });
  execDebugPauseResumeButton.addEventListener("click", () => {
    const {state} = controller.getSnapshot();
    if (state === "paused") {
      resumeExecution();
    } else {
      controller.pause();
    }
  });
  execRewindButton.addEventListener("click", () => {
    void (async () => {
      if (!executionRewind) return;
      const {state} = controller.getSnapshot();
      if (state === "running") controller.pause();
      execRewindButton.disabled = true;
      try {
        const result = await executionRewind.rewindFrame();
        if (!result.ok && result.error) {
          appToast.show(result.error);
        }
      } finally {
        render();
      }
    })();
  });
  execStepButton.addEventListener("click", () => {
    void (async () => {
      const snapshot = executionRewind?.getSnapshot();
      if (
        snapshot?.canScrub &&
        snapshot.scrubDepthForward > 0 &&
        executionController?.getSnapshot().state === "paused"
      ) {
        execStepButton.disabled = true;
        try {
          const result = await executionRewind!.scrubForwardOneFrame();
          if (!result.ok && result.error) {
            appToast.show(result.error);
          }
        } finally {
          render();
        }
        return;
      }
      controller.stepFrame();
    })();
  });

  const runScrubToSliderValue = (value: number): void => {
    void (async () => {
      if (!executionRewind) return;
      const {state} = controller.getSnapshot();
      if (state === "running") controller.pause();
      execScrubInput.disabled = true;
      try {
        const result = await executionRewind.scrubToFrame(value);
        if (!result.ok && result.error) {
          appToast.show(result.error);
        }
      } finally {
        render();
      }
    })();
  };

  execScrubInput.addEventListener("input", () => {
    updateScrubSliderFill(execScrubInput);
    if (scrubDebounceTimer !== null) {
      window.clearTimeout(scrubDebounceTimer);
    }
    const value = Number(execScrubInput.value);
    scrubDebounceTimer = window.setTimeout(() => {
      scrubDebounceTimer = null;
      runScrubToSliderValue(value);
    }, 150);
  });
  execScrubInput.addEventListener("change", () => {
    if (scrubDebounceTimer !== null) {
      window.clearTimeout(scrubDebounceTimer);
      scrubDebounceTimer = null;
    }
    runScrubToSliderValue(Number(execScrubInput.value));
  });
  execScrubInput.addEventListener("pointerup", () => {
    if (scrubDebounceTimer !== null) {
      window.clearTimeout(scrubDebounceTimer);
      scrubDebounceTimer = null;
    }
    runScrubToSliderValue(Number(execScrubInput.value));
  });

  // Green flag runs every sprite. Learners often stare at an empty workspace
  // on the selected sprite and think the editor is moving "with no blocks".
  const runtime = vmInstance.runtime as ScratchVm["runtime"] & {
    on?: (event: string, handler: (...args: unknown[]) => void) => void;
  };
  runtime.on?.("PROJECT_START", () => {
    queueMicrotask(() => {
      enforceWorkspaceMatchesVm(vmInstance, {announce: true});
      warnIfGreenFlagRunsOtherSprites(vmInstance);
    });
  });

  // Catch Blockly/VM desync even when the learner is not pressing the flag.
  window.setInterval(() => {
    enforceWorkspaceMatchesVm(vmInstance, {announce: true});
  }, 500);

  render();
  installRewindInvalidationListeners();
}

let emptyWorkspaceGuardToastAt = 0;

/**
 * If the Blockly workspace shows no scripts but the editing target still has
 * VM scripts or running threads, stop execution and record diagnostics.
 * VM blocks are not deleted automatically — the learner chooses how to recover.
 */
function enforceWorkspaceMatchesVm(
  vmInstance: ScratchVm,
  options: {announce?: boolean} = {},
): void {
  // While boot / project load is rewriting the VM, Blockly can briefly look
  // empty even though scripts are about to be painted. Do not "heal" then.
  if (suppressVmChanges || !diagnostic.ready) return;

  const workspace = scratchWorkspace() as {
    isDragging?: () => boolean;
    getTopBlocks?: (ordered?: boolean) => Array<{
      isShadow?: () => boolean;
      type?: string;
    }>;
  } | null;
  const editingId = vmInstance.editingTarget?.id;
  const editingTarget =
    typeof editingId === "string"
      ? (vmInstance.runtime.targets.find(t => t.id === editingId) ?? null)
      : null;
  const result = reconcileEmptyWorkspaceWithVm({
    workspace,
    runtime: vmInstance.runtime as import("./workspace-run-guard.js").GuardRuntimeLike,
    editingTarget,
  });
  if (!result?.detected) return;
  if (result.stopped) {
    clearExecutionRewindHistory("vm-blockly-desync");
  }
  if (!options.announce) return;
  const now = Date.now();
  if (now - emptyWorkspaceGuardToastAt < 4000) return;
  emptyWorkspaceGuardToastAt = now;
  appToast.show(
    result.stopped
      ? "画面上にブロックが無いのに実行されていました。安全のため実行を止めました。"
      : "画面上にブロックが無いのにスクリプトが残っています。保存前に内容を確認してください。",
  );
}

/** True when `target` still has a when-green-flag-clicked hat. */
function targetHasGreenFlagHat(target: {blocks: VmBlocks}): boolean {
  const scripts = target.blocks.getScripts?.();
  if (!Array.isArray(scripts)) return false;
  for (const id of scripts) {
    const block = target.blocks.getBlock(id) as {opcode?: string} | null;
    if (block?.opcode === "event_whenflagclicked") return true;
  }
  return false;
}

/**
 * Tell the learner when the flag will move a *different* sprite than the one
 * whose empty workspace they are looking at.
 */
function warnIfGreenFlagRunsOtherSprites(vmInstance: ScratchVm): void {
  const editing = vmInstance.editingTarget;
  if (!editing) return;
  const targets = vmInstance.runtime.targets;
  const editingTarget = targets.find(t => t.id === editing.id);
  if (!editingTarget || targetHasGreenFlagHat(editingTarget)) return;
  const others = targets.filter(
    t => t.id !== editingTarget.id && targetHasGreenFlagHat(t),
  );
  if (others.length === 0) return;
  const names = others.map(t => t.getName()).slice(0, 2).join("・");
  appToast.show(
    others.length === 1
      ? `いまのスプライトにはブロックがありません。「${names}」のスクリプトが動きます`
      : `いまのスプライトにはブロックがありません。「${names}」など別のスプライトが動きます`,
  );
}

function installDefaultExtensionGallery(
  state: EditorGuiState,
  scratchVm: ScratchVm,
): void {
  const gallery = createExtensionGalleryUi({
    getVm: () => scratchVm as ExtensionVm,
    onLoaded: (extensionId, alreadyLoaded) => {
      if (extensionId) {
        // Stock GUI may skip toolbox refresh when theme setup throws after
        // EXTENSION_ADDED. Re-emit + inject category XML so TurboWarp/Xcratch
        // blocks actually appear in the palette.
        void ensureExtensionInToolbox({
          vm: scratchVm,
          store: state.store,
          extensionId,
          scratchBlocks: resolveScratchBlocksApi(guiHost) as ScratchBlocksLike | null,
          resolveScratchBlocks: () =>
            resolveScratchBlocksApi(guiHost) as ScratchBlocksLike | null,
          // Do not auto-select the new category: continuous flyout would scroll
          // to an empty section and look like every block vanished.
        }).then(visible => {
          if (!visible) {
            appToast.show(
              `「${extensionId}」は読み込みましたが、ブロック一覧への反映に失敗しました。別のスプライトを選ぶか、ページを再読み込みしてください`,
            );
          }
        });
      }
      if (alreadyLoaded && extensionId) {
        appToast.show(`「${extensionId}」はすでに追加されています`);
        return;
      }
      if (extensionId) {
        appToast.show(`「${extensionId}」を追加しました`);
        return;
      }
      appToast.show("拡張機能を追加しました");
    },
    onError: message => {
      appToast.show(message);
    },
    promptUrl: message => window.prompt(message),
  });

  let intercepting = false;
  state.store.subscribe?.(() => {
    if (intercepting) return;
    if (!isExtensionLibraryOpen(state.store.getState())) return;
    if (gallery.isOpen()) {
      // Keep Scratch's modal closed while ours is visible.
      intercepting = true;
      try {
        state.store.dispatch(closeExtensionLibraryAction());
      } finally {
        intercepting = false;
      }
      return;
    }
    intercepting = true;
    try {
      state.store.dispatch(closeExtensionLibraryAction());
      gallery.open();
    } finally {
      intercepting = false;
    }
  });
}

function clearScratchRestoreSlot(): void {
  if (!editorGuiState) return;
  editorGuiState.store.dispatch({
    type: "scratch-gui/restore-deletion/RESTORE_UPDATE",
    state: {restoreFun: null, deletedItem: ""},
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
  if (studentPolicy && isStudentDriveFullyBlocked(studentPolicy)) {
    driveStatus.textContent = CLASSROOM_DRIVE_BLOCKED_STATUS;
    driveStatus.title = CLASSROOM_DRIVE_BLOCKED_STATUS;
    connectGoogleButton.hidden = true;
    openDriveButton.hidden = true;
    saveDriveButton.hidden = true;
    disconnectGoogleButton.hidden = true;
    driveControls.hidden = true;
    return;
  }
  driveControls.hidden = false;
  connectGoogleButton.hidden = false;
  openDriveButton.hidden = false;
  saveDriveButton.hidden = false;
  disconnectGoogleButton.hidden = false;

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
  lastDriveRawMessage = detailMessage;
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
  // Disconnected: emphasize Connect. Connected (and allowed to write): always
  // emphasize Save so it cannot blend into the gray Drive card.
  connectGoogleButton.classList.toggle(
    "drive-connect-primary",
    !controls.connectDisabled && status === "disconnected",
  );
  saveDriveButton.classList.toggle(
    "drive-save-primary",
    !controls.saveDisabled && !controls.guestDriveBlocked,
  );
  disconnectGoogleButton.disabled = controls.disconnectDisabled;
  if (conflictAction === "report") collabSession?.reportDriveConflict();
  if (conflictAction === "clear") collabSession?.clearDriveConflict();
  if (!collabSession && !syncingDriveControlsFromCollab) {
    renderCollabIdle(lastCollabIdleMessage);
  } else {
    renderProjectStatus();
  }
  const connected = !["not-configured", "disconnected"].includes(status);
  if (connected && !googleAvatarUrl) {
    void syncGoogleAvatarProfile();
  } else if (!connected && (googleAvatarUrl || googleDisplayName)) {
    googleAvatarFetchGeneration += 1;
    googleAvatarUrl = undefined;
    googleDisplayName = undefined;
    publishLocalCollabProfile();
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

async function clearDriveFileId(
  localProjectId: string,
  signal?: AbortSignal,
): Promise<void> {
  await clearDriveFileIdAndSyncCurrent({
    store,
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
    clearDriveFileId,
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
  ensureBlocklyVmEventPipeline();
  installWorkspaceUpdateListener(
    vm as import("./workspace-update-instrumentation.js").WorkspaceUpdateListenerVm,
    readWorkspaceUpdateInstrumentationContextFull,
    blocklyWorkspace,
  );
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
    try {
      await loadRecord(latest);
    } catch (error) {
      // Last-resort recovery: keep the saved record in IndexedDB, open a fresh
      // in-memory fixture so the editor is usable, and surface the real error.
      diagnostic.error =
        error instanceof Error ? error.message : String(error);
      console.error("[syncratch] failed to restore saved project", error);
      const fallback = await loadFixtureRecord(
        crypto.randomUUID(),
        "一時的な新しい作品",
      );
      await loadRecord(fallback);
      appToast.show(
        "保存されていた作品を開けませんでした。新しい作品を表示しています。ページを再読み込みするか、ファイルから開き直してください。",
      );
    }
  }
  diagnostic.ready = true;
  driveReady = true;
  const oauthReturn = consumeDriveOAuthReturnFlag();
  renderDriveStatus(driveIntegration.getStatus());
  await driveIntegration.tryRestoreSession();
  await syncGoogleAvatarProfile();

  // OAuth cancel / missing refresh_token / expired state returns here with
  // drive_oauth=error. Do not auto-redirect back to Google — that looks like
  // being stuck on the account chooser.
  if (oauthReturn === "error") {
    appToast.show(COLLAB_GOOGLE_OAUTH_FAILED);
    renderCollabIdle(COLLAB_GOOGLE_OAUTH_FAILED);
    return;
  }

  // After host OAuth for "create link", resume create once Google is ready.
  // Peek first so a failed/incomplete connect does not wipe the pending flag.
  if (
    peekPendingHostCreate() &&
    driveIntegration.isConnected() &&
    shouldGateCollabOnGoogle(driveIntegration.getStatus())
  ) {
    consumePendingHostCreate();
    renderCollabIdle();
    await createRoom();
    return;
  }

  const fragmentInvite = decodeInviteFragment(window.location.hash);
  const pendingGuest = peekPendingGuestInvite();
  const guestInvite = fragmentInvite ?? pendingGuest;
  if (guestInvite) {
    // Opening a shared invite URL joins after Google (when configured).
    collabInviteInput.value = inviteUrl(window.location.href, guestInvite);
    ensureInviteHashOnLocation(guestInvite);
    renderCollabIdle();
    if (!(await ensureGoogleBeforeCollab({role: "guest", invite: guestInvite}))) {
      return;
    }
    consumePendingGuestInvite();
    await startCollaboration(guestInvite, false);
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
scratchLocaleSelect.addEventListener("change", () => {
  if (!editorGuiState) return;
  selectLocale(editorGuiState.store, scratchLocaleSelect.value);
  document.documentElement.lang =
    scratchLocaleSelect.value === "ja" ||
    scratchLocaleSelect.value.startsWith("ja-")
      ? "ja"
      : scratchLocaleSelect.value.startsWith("en")
        ? "en"
        : document.documentElement.lang;
});
scratchColorModeSelect.addEventListener("change", () => {
  if (!editorGuiState) return;
  setColorMode(editorGuiState.store, scratchColorModeSelect.value);
});
editUndoButton.addEventListener("click", () => {
  ensureBlockUndoKeepAlive();
  const ok = undoBlocks(scratchWorkspace() as BlockWorkspaceLike | null);
  editStatus.textContent = ok
    ? "ひとつ もとにもどしたよ。"
    : "いま もどせる てじゅんは ないよ。";
  syncScratchNativeMenuControls();
});
editRedoButton.addEventListener("click", () => {
  ensureBlockUndoKeepAlive();
  const ok = redoBlocks(scratchWorkspace() as BlockWorkspaceLike | null);
  editStatus.textContent = ok
    ? "やりなおしたよ。"
    : "いま やりなおせる てじゅんは ないよ。";
  syncScratchNativeMenuControls();
});
restoreDeletionButton.addEventListener("click", () => {
  const result = popAndRestoreDeletion(deletionStackState);
  deletionStackState = result.state;
  clearScratchRestoreSlot();
  editStatus.textContent = result.restored
    ? "けしたものを もどしたよ。"
    : "いま もどせるものは ないよ。";
  syncScratchNativeMenuControls();
});
toggleTurboButton.addEventListener("click", () => {
  if (!editorGuiState || !vm) return;
  const on = toggleTurboMode(vm, editorGuiState.store);
  editStatus.textContent = on
    ? "ターボモードを オンにしたよ。"
    : "ターボモードを オフにしたよ。";
  syncScratchNativeMenuControls();
});
retryButton.addEventListener("click", () => void saveCoordinator.flush());
connectGoogleButton.addEventListener("click", () => {
  // If already in a room, keep the invite hash so OAuth return can rejoin.
  if (activeInvite) ensureInviteHashOnLocation(activeInvite);
  const pendingGuest = peekPendingGuestInvite();
  if (pendingGuest) ensureInviteHashOnLocation(pendingGuest);
  void driveIntegration
    .connect()
    .then(async connected => {
      await syncGoogleAvatarProfile();
      if (!connected && !driveIntegration.isConnected()) return;
      // Finish a guest join that was waiting on Google.
      const invite =
        consumePendingGuestInvite() ??
        decodeInviteFragment(window.location.hash);
      if (invite && !collabSession) {
        collabInviteInput.value = inviteUrl(window.location.href, invite);
        await startCollaboration(invite, false);
      }
    })
    .finally(() => {
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
  googleAvatarFetchGeneration += 1;
  googleAvatarUrl = undefined;
  googleDisplayName = undefined;
  publishLocalCollabProfile();
  renderProjectStatus();
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

createRoomButton.addEventListener("click", () => {
  if (collabSession) {
    leaveRoom();
    closePanelFor(createRoomButton);
    return;
  }
  void createRoom();
});
joinRoomButton.addEventListener("click", () => void joinRoom());
copyInviteButton.addEventListener("click", () => {
  void copyActiveInviteLink({panelFeedback: true});
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

let aiSettings: AiAssistSettings =
  SURFACE_MODE.kind === "student" || SURFACE_MODE.kind === "admin"
    ? {...DEFAULT_AI_SETTINGS}
    : loadAiAssistSettings(
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
  const isUser = turn.role === "user";
  wrap.className = isUser
    ? "ai-msg ai-msg--user ai-thread-turn ai-thread-turn-user"
    : "ai-msg ai-msg--ai ai-thread-turn ai-thread-turn-assistant";
  const role = document.createElement("span");
  role.className = "ai-msg__label ai-thread-role";
  if (isUser) {
    role.textContent = "きみ";
  } else {
    role.innerHTML =
      `<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">` +
      `<path fill="currentColor" d="M12 2l1.6 4.9L18 8.5l-4.4 1.6L12 15l-1.6-4.9L6 8.5l4.4-1.6L12 2z"/>` +
      `</svg>` +
      `AI`;
  }
  wrap.append(role);
  if (isUser) {
    const body = document.createElement("p");
    body.className = "ai-answer-text";
    body.textContent = turn.content;
    wrap.append(body);
  } else {
    const body = document.createElement("div");
    body.innerHTML = formatAiAnswerHtml(turn.content);
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
  setMenuButtonLabel(aiAskButton, active ? "つづけてきく" : "AI にきく");
  aiQuestionInput.placeholder = active
    ? "例: やってみたけど、うまくいかなかった"
    : "例: このスプライトが動かないのはなぜ？";
  aiQuestionInput.rows = active ? 4 : 5;
  aiPanel.classList.toggle("ai-panel--answering", active);
  aiPanelContent.classList.toggle("ai-panel--answering", active);
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
  if (studentPolicy && studentPolicyBlocksAiPersist(studentPolicy)) {
    aiSettings = aiSettingsFromStudentPolicy(studentPolicy);
    applyAiSettingsToForm(aiSettings);
    renderAiUi(aiSettings);
    aiSettingsFeedback.textContent =
      "このリンクでは設定を変更できません（管理者の設定に従います）。";
    return aiSettings;
  }
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

const diagnosticController = createDiagnosticController({
  captureSnapshot: () =>
    captureLiveProjectSnapshot({
      readVmJson:
        typeof vm === "undefined" || !vm
          ? null
          : () => vm.toJSON(),
      previousDocument: hasCurrent ? current.document : null,
      assetHashes:
        typeof vm === "undefined" || !vm
          ? undefined
          : assetHashCache.hashesFor(runtimeAssetMap()),
    }),
});

const diagnosticUiBindings = {
  runButton: diagnosticRunButton,
  statusEl: diagnosticStatus,
  resultsEl: diagnosticResults,
  feedbackEl: diagnosticFeedback,
};

function paintDiagnosticView(): void {
  renderDiagnosticView(
    diagnosticUiBindings,
    diagnosticController.getViewModel(),
    {
      onReveal: findingId => {
        diagnosticController.revealNextHint(findingId);
        paintDiagnosticView();
      },
    },
  );
}

paintDiagnosticView();

diagnosticRunButton.addEventListener("click", () => {
  void (async () => {
    // Kick off run (sets running) then paint after the first microtask.
    const pending = diagnosticController.run();
    paintDiagnosticView();
    await pending;
    paintDiagnosticView();
    diagnosticPanel.open = true;
    diagnosticRunButton.focus();
  })();
});

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

function stripAiChoiceLetterPrefix(label: string): string {
  return label.replace(/^[A-D][:：．.]\s*/i, "").trim();
}

function appendAiChoiceButton(options: {
  letter: string;
  label: string;
  altKey?: boolean;
  other?: boolean;
  choiceId?: string;
  onClick: () => void;
}): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = options.other
    ? "ai-choice ai-choice--other"
    : "ai-choice";
  if (options.choiceId) button.dataset.choiceId = options.choiceId;
  const key = document.createElement("span");
  key.className = options.altKey
    ? "ai-choice__key ai-choice__key--alt"
    : "ai-choice__key";
  key.textContent = options.letter;
  button.append(key, document.createTextNode(options.label));
  button.addEventListener("click", options.onClick);
  aiClarifyChoices.append(button);
}

function renderAiClarifyPrompt(clarify: AiClarifyPrompt): void {
  aiClarifyPromptEl.textContent = clarify.promptText;
  aiClarifyChoices.replaceChildren();
  clarify.choices.forEach((choice, index) => {
    const letter = String.fromCharCode(65 + index);
    appendAiChoiceButton({
      letter,
      label: stripAiChoiceLetterPrefix(choice.label) || choice.label,
      altKey: index > 0,
      choiceId: choice.id,
      onClick: () => {
        hideAiClarify();
        void askAiWithIntent(choice);
      },
    });
  });
  if (clarify.allowOther) {
    appendAiChoiceButton({
      letter: "D",
      label: "そのほか（じぶんで かく）",
      other: true,
      onClick: () => {
        aiClarifyOther.hidden = false;
        aiClarifyOtherInput.focus();
      },
    });
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
    const stillTruncated = looksTruncatedAiAnswer(answerContent);
    if (stillTruncated) {
      // Keep the question so the learner can retry without retyping.
      aiFeedback.textContent =
        "こたえが途中で止まっているみたい。同じしつもんで、もういちどきいてみてね。";
    } else {
      aiQuestionInput.value = "";
      aiFeedback.textContent = "";
    }
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

async function startEditorSurface(): Promise<void> {
  if (SURFACE_MODE.kind === "admin") {
    if (!adminShell) {
      throw new Error("admin shell missing");
    }
    await startAdminSurface(adminShell);
    return;
  }

  const revealStudentEditor = (policy: StudentPolicyView) => {
    studentPolicy = policy;
    if (studentAuthShell) hideStudentAuthShell(studentAuthShell);
    aiSettings = aiSettingsFromStudentPolicy(policy);
    applyAiSettingsToForm(aiSettings);
    renderAiUi(aiSettings);
    applyStudentPolicyToDom(policy, {
      settingsPanel: document.querySelector<HTMLElement>(
        '[data-testid="settings-panel"]',
      ),
      aiPanel,
      aiEnabledInput,
      aiApiKeyInput,
      aiSettingsSaveButton,
      downloadButton,
      openButton,
      fileInput,
      connectGoogleButton,
      openDriveButton,
      saveDriveButton,
      disconnectGoogleButton,
      createRoomButton,
      joinRoomButton,
      copyInviteButton,
      collabInviteInput,
      driveStatus,
      driveSectionHelp,
      driveControls,
      drivePanel: document.querySelector<HTMLElement>(
        '[data-testid="drive-panel"]',
      ),
      collabPanel: document.querySelector<HTMLElement>(
        '[data-testid="collab-panel"]',
      ),
      filePanel: document.querySelector<HTMLElement>(
        '[data-testid="file-panel"]',
      ),
    });
    if (
      policy.submission.enabled &&
      policy.studentAuth.required &&
      studentSubmissionPanel
    ) {
      showStudentSubmissionUi(studentSubmissionPanel);
      mountStudentSubmissionUi({
        root: studentSubmissionPanel,
        exportSb3: exportCurrentSb3,
        getProjectTitle: () => titleInput.value,
      });
    } else if (studentSubmissionPanel) {
      hideStudentSubmissionUi(studentSubmissionPanel);
    }
    if (appMain) appMain.hidden = false;
  };

  let studentBootStarted = false;
  const startStudentBootOnce = async () => {
    if (studentBootStarted) return;
    studentBootStarted = true;
    await boot();
  };

  if (SURFACE_MODE.kind === "student") {
    let policy: StudentPolicyView | null = null;
    if (SURFACE_MODE.token) {
      const exchanged = await exchangeStudentGrant(SURFACE_MODE.token);
      if (!exchanged) {
        if (studentErrorShell) showStudentLinkError(studentErrorShell);
        return;
      }
      replaceStudentUrlWithoutToken();
      policy = await fetchStudentPolicyFromGrant();
    } else {
      policy = await fetchStudentPolicyFromGrant();
    }
    if (!policy) {
      if (studentErrorShell) showStudentLinkError(studentErrorShell);
      return;
    }
    if (shouldShowStudentAuthGate(policy)) {
      const identity = await fetchStudentIdentitySession();
      if (identity) {
        revealStudentEditor(policy);
        await startStudentBootOnce();
        return;
      }
      if (studentAuthShell) {
        showStudentAuthShell(studentAuthShell, {
          onAuthenticated: () => {
            revealStudentEditor(policy!);
            void startStudentBootOnce();
          },
        });
      }
      if (appMain) appMain.hidden = true;
      return;
    }
    revealStudentEditor(policy);
    await startStudentBootOnce();
    return;
  }

  await boot();
}

startEditorSurface().catch(error => {
  diagnostic.error = error instanceof Error ? error.message : String(error);
  fatalBootError =
    "エディターを始められませんでした。ページを読み直してください。";
  console.error("[syncratch] boot failed", error);
  if (appMain) appMain.hidden = false;
  setGuiSplashVisible(guiSplash, true);
  setGuiSplashProgress(guiSplash, {
    ratio: 1,
    label: "エディターを始められませんでした。ページを読み直してください。",
  });
  driveReady = false;
  renderDriveStatus(driveIntegration.getStatus());
});
