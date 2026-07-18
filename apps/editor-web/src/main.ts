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
import {
  createProjectSessionTracker,
  type ProjectSession,
} from "./project-session.js";
import {
  createMemoryAssetLoader,
  type MemoryAssetStorage,
} from "./scratch-storage-loader.js";

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
const guiHost = requiredElement<HTMLElement>("scratch-gui");

let store: ProjectStore;
let vm: ScratchVm;
let current: LocalProjectRecord;
let hasCurrent = false;
let saveCoordinator: SaveCoordinator;
let suppressVmChanges = true;
let failNextWrite = false;
const projectSessions = createProjectSessionTracker();

const diagnostic = {
  ready: false,
  error: null as string | null,
  createTestBlock(id: string): void {
    const target = vm.runtime.targets.find(candidate => !candidate.isStage);
    if (!target) throw new Error("Sprite target missing");
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
  hasBlock(id: string): boolean {
    const target = vm.runtime.targets.find(candidate => !candidate.isStage);
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
  const hashes = new Map<string, string>();
  for (const [md5ext, bytes] of assets) {
    hashes.set(md5ext, sha256Hex(bytes));
  }
  return projectJsonToDocument(JSON.parse(vm.toJSON()), hashes);
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
}

async function loadRecord(record: LocalProjectRecord): Promise<void> {
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
    fetch("/generated/fixtures/cat-project.json"),
    fetch("/generated/fixtures/assets.b64.json"),
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

async function importProject(bytes: Uint8Array, title: string): Promise<void> {
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
  };
  await store.createOrReplace(record, null);
  try {
    await loadRecord(record);
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
}

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

boot().catch(error => {
  diagnostic.error = error instanceof Error ? error.message : String(error);
  saveStatus.textContent = "Error";
});
