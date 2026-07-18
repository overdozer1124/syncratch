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

interface ScratchStorageInstance {
  AssetType: {
    Sound: unknown;
    ImageVector: unknown;
    ImageBitmap: unknown;
  };
  DataFormat: {
    SVG: string;
    WAV: string;
    MP3: string;
    PNG: string;
  };
  addHelper(helper: {
    load(
      assetType: unknown,
      assetId: string,
      dataFormat: string,
    ): Promise<unknown>;
  }): void;
  createAsset(
    assetType: unknown,
    dataFormat: string,
    bytes: Uint8Array,
    assetId: string,
    generateMd5: boolean,
  ): unknown;
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
let saveCoordinator: SaveCoordinator;
let suppressVmChanges = true;
let failNextWrite = false;

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
window.__blocksyncTask3 = diagnostic;

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

function assetTypeFor(
  storage: ScratchStorageInstance,
  format: string,
): unknown {
  if (format === "wav" || format === "mp3") return storage.AssetType.Sound;
  if (format === "svg") return storage.AssetType.ImageVector;
  return storage.AssetType.ImageBitmap;
}

function storageFormatFor(
  storage: ScratchStorageInstance,
  format: string,
): string {
  if (format === "svg") return storage.DataFormat.SVG;
  if (format === "wav") return storage.DataFormat.WAV;
  if (format === "mp3") return storage.DataFormat.MP3;
  return storage.DataFormat.PNG;
}

function attachLocalStorage(record: LocalProjectRecord): void {
  const assets = assetMap(record);
  const storage = new GUI.ScratchStorage();
  storage.addHelper({
    load(requestedType, assetId, dataFormat) {
      const format = String(dataFormat).toLowerCase();
      const md5ext = `${assetId}.${format}`;
      const bytes = assets.get(md5ext);
      if (!bytes) return Promise.resolve(null);
      const expectedType = assetTypeFor(storage, format);
      const requestedName =
        (requestedType as {name?: string})?.name ?? String(requestedType);
      const expectedName =
        (expectedType as {name?: string})?.name ?? String(expectedType);
      if (requestedName !== expectedName) return Promise.resolve(null);
      return Promise.resolve(
        storage.createAsset(
          expectedType,
          storageFormatFor(storage, format),
          bytes,
          assetId,
          false,
        ),
      );
    },
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

async function persistCurrent(): Promise<void> {
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
  current = await store.createOrReplace(next, current.revision);
}

function renderSaveState(state: LocalSaveState): void {
  saveStatus.textContent = statusText[state];
  retryButton.hidden = state !== "error" && state !== "conflict";
}

function installSaveCoordinator(): void {
  saveCoordinator?.dispose();
  saveCoordinator = createSaveCoordinator({
    debounceMs: 250,
    save: persistCurrent,
    onState: renderSaveState,
  });
  renderSaveState("clean");
}

function markDirty(): void {
  if (suppressVmChanges) return;
  saveCoordinator.markDirty();
}

async function loadRecord(record: LocalProjectRecord): Promise<void> {
  suppressVmChanges = true;
  current = structuredClone(record);
  titleInput.value = current.title;
  attachLocalStorage(current);
  await vm.loadProject(documentToProjectJson(current.document));
  installSaveCoordinator();
  suppressVmChanges = false;
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
  await loadRecord(record);
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
  await loadRecord(record);
}

function download(bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], {type: "application/x.scratch.sb3"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${titleInput.value || "project"}.sb3`;
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
  const records = await store.list();
  if (records.length === 0) {
    const initial = await loadFixtureRecord();
    await store.createOrReplace(initial, null);
    await loadRecord(initial);
  } else {
    await loadRecord(records[0]!);
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
      new Uint8Array(await file.arrayBuffer()),
      file.name.replace(/\.sb3$/i, ""),
    );
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
