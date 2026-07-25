import {
  defaultExtensionCatalog,
  type DefaultExtensionEntry,
  type ExtensionKind,
} from "@blocksync/project-schema";

export type ExtensionLoadMode = "builtin" | "module" | "loader" | "unavailable";

export interface ExtensionGalleryItem {
  key: string;
  extensionId: string | null;
  name: string;
  description: string;
  collaborator: string | null;
  extensionURL: string | null;
  kind: ExtensionKind;
  sources: string[];
  loadMode: ExtensionLoadMode;
  /** Shown under the name when the item cannot be loaded yet. */
  statusNote: string | null;
}

export type ExtensionVm = {
  extensionManager: {
    isExtensionLoaded(extensionId: string): boolean;
    loadExtensionURL(extensionURL: string): Promise<unknown>;
    _loadedExtensions: Map<string, string>;
    _registerInternalExtension(extensionObject: {getInfo(): {id: string}}): string;
  };
  runtime: unknown;
};

export type XcratchExtensionModule = {
  blockClass?: new (runtime: unknown) => {getInfo(): {id: string}};
  entry?: {extensionId?: string};
};

const STOCK_BUILTIN_IDS = new Set([
  "music",
  "pen",
  "videoSensing",
  "text2speech",
  "translate",
  "makeymakey",
  "microbit",
  "ev3",
  "boost",
  "wedo2",
  "gdxfor",
  "faceSensing",
]);

const NAME_JA: Record<string, string> = {
  music: "音楽",
  pen: "ペン",
  videoSensing: "ビデオモーションセンサー",
  text2speech: "テキスト読み上げ",
  translate: "翻訳",
  makeymakey: "Makey Makey",
  microbit: "micro:bit",
  ev3: "LEGO MINDSTORMS EV3",
  boost: "LEGO BOOST",
  wedo2: "LEGO Education WeDo 2.0",
  gdxfor: "Go Direct 力と加速度",
  ml2scratch: "ML2Scratch",
  posenet2scratch: "Posenet2Scratch",
  microbitMore: "micro:bit More",
  tm2scratch: "TM2Scratch",
  tmpose2scratch: "TMPose2Scratch",
  g2s: "AkaDako",
  scratch2maqueen: "Scratch2Maqueen",
  facemesh2scratch: "Facemesh2Scratch",
  handpose2scratch: "Handpose2Scratch",
  pasorich: "PaSoRich 2.0",
  qrcode: "QRコード",
  speech2scratch: "Speech2Scratch",
  ic2scratch: "ImageClassifier2Scratch",
  iftttWebhooks: "IFTTT Webhooks",
  numberbank: "NumberBank 2.0",
  duplotrain: "LEGO DUPLO トレイン",
  geoscratch: "Geo Scratch",
  chatgpt2scratch: "ChatGPT2Scratch",
  scratch2webserialapi: "Scratch2WebSerialAPI",
  cameraselector: "カメラ選択",
  screenshot: "スクリーンショット",
  webapiExtension: "データツール",
  xcxArduino: "Arduino",
  gai: "GAI（生成AI）",
  extensionLoader: "拡張機能を読み込む",
};

const DESC_JA: Record<string, string> = {
  music: "楽器やドラムを演奏する。",
  pen: "スプライトで絵を描く。",
  videoSensing: "カメラで動きを感じ取る。",
  text2speech: "文字を声に出して読む。",
  translate: "いろいろな言語に翻訳する。",
  makeymakey: "何でもキーにできる。",
  microbit: "小さなコンピュータとつなぐ。",
  ev3: "ロボットなどを作って動かす。",
  boost: "ロボットの作品を動かす。",
  wedo2: "モーターやセンサーで作る。",
  gdxfor: "押す・引く・動き・回転を感じ取る。",
  ml2scratch: "機械学習で画像を見分ける。",
  posenet2scratch: "カメラで人のポーズを検出する。",
  microbitMore: "micro:bit の機能をもっと使う。",
  tm2scratch: "Teachable Machine の画像・音声モデルを使う。",
  tmpose2scratch: "Teachable Machine のポーズモデルを使う。",
  g2s: "Grove のセンサーやアクチュエーターをつなぐ。",
  scratch2maqueen: "Maqueen ロボットをプログラムする。",
  facemesh2scratch: "カメラで顔を追跡する。",
  handpose2scratch: "カメラで手や指を追跡する。",
  pasorich: "PaSoRi で IC カードを読む。",
  qrcode: "QRコードを読み取る。",
  speech2scratch: "声を文字に変換する。",
  ic2scratch: "カメラの映像が何かを判定する。",
  iftttWebhooks: "IFTTT 経由で他のサービスと連携する。",
  numberbank: "クラウドに数字を保存する。",
  duplotrain: "LEGO DUPLO の機関車を動かす。",
  geoscratch: "地図を Scratch から操作する。",
  chatgpt2scratch: "ChatGPT を Scratch から使う。",
  scratch2webserialapi: "Web Serial API でシリアル通信する。",
  cameraselector: "使うカメラを切り替える。",
  screenshot: "ステージのスクリーンショットを撮る。",
  webapiExtension: "Web API にアクセスして JSON を扱う。",
  xcxArduino: "Arduino を操作する。",
  gai: "生成AIを Scratch から使う。",
  extensionLoader: "インターネットから拡張機能を読み込む。",
};

export function closeExtensionLibraryAction(): {
  type: string;
  modal: string;
} {
  return {
    type: "scratch-gui/modals/CLOSE_MODAL",
    modal: "extensionLibrary",
  };
}

export function isExtensionLibraryOpen(storeState: unknown): boolean {
  if (!storeState || typeof storeState !== "object") return false;
  const gui = (storeState as {scratchGui?: {modals?: {extensionLibrary?: unknown}}})
    .scratchGui;
  return gui?.modals?.extensionLibrary === true;
}

export function loadModeForEntry(entry: DefaultExtensionEntry): ExtensionLoadMode {
  if (entry.kind === "loader") return "loader";
  if (
    typeof entry.extensionId === "string" &&
    STOCK_BUILTIN_IDS.has(entry.extensionId)
  ) {
    return "builtin";
  }
  if (entry.extensionURL) return "module";
  return "unavailable";
}

export function buildExtensionGalleryItems(
  catalog = defaultExtensionCatalog,
): ExtensionGalleryItem[] {
  return catalog.extensions.map(entry => {
    const key =
      entry.extensionId ??
      entry.catalogId ??
      entry.name.toLowerCase().replace(/\s+/g, "-");
    const loadMode = loadModeForEntry(entry);
    let statusNote: string | null = null;
    if (loadMode === "unavailable") {
      statusNote = "この環境ではまだ読み込めません";
    } else if (loadMode === "module") {
      statusNote = "外部モジュール（Stretch3 / Xcratch）";
    } else if (loadMode === "loader") {
      statusNote = "URL を指定して読み込む";
    }
    return {
      key,
      extensionId: entry.extensionId,
      name: NAME_JA[key] ?? entry.name,
      description: DESC_JA[key] ?? entry.description,
      collaborator: entry.collaborator,
      extensionURL: entry.extensionURL,
      kind: entry.kind,
      sources: [...entry.sources],
      loadMode,
      statusNote,
    };
  });
}

type ExtensionModuleImporter = (
  url: string,
) => Promise<XcratchExtensionModule>;

/** Dynamic import that Vite will not rewrite into a local chunk. */
export const defaultExtensionModuleImporter: ExtensionModuleImporter = (
  url,
) => {
  const importer = new Function(
    "u",
    "return import(u)",
  ) as (u: string) => Promise<XcratchExtensionModule>;
  return importer(url);
};

let extensionModuleImporter: ExtensionModuleImporter =
  defaultExtensionModuleImporter;

/** Test-only seam for module loading. */
export function setExtensionModuleImporterForTests(
  importer: ExtensionModuleImporter | null,
): void {
  extensionModuleImporter = importer ?? defaultExtensionModuleImporter;
}

export function importExtensionModule(
  url: string,
): Promise<XcratchExtensionModule> {
  return extensionModuleImporter(url);
}

export async function loadGalleryExtension(
  vm: ExtensionVm,
  item: ExtensionGalleryItem,
  options?: {promptUrl?: () => string | null},
): Promise<{extensionId: string | null; alreadyLoaded: boolean}> {
  if (item.loadMode === "loader") {
    const url = options?.promptUrl?.() ?? null;
    if (!url) {
      return {extensionId: null, alreadyLoaded: false};
    }
    await loadExtensionModuleUrl(vm, url);
    return {extensionId: null, alreadyLoaded: false};
  }

  if (item.loadMode === "unavailable" || !item.extensionId) {
    throw new Error(`${item.name} はまだ読み込めません`);
  }

  if (vm.extensionManager.isExtensionLoaded(item.extensionId)) {
    return {extensionId: item.extensionId, alreadyLoaded: true};
  }

  if (item.loadMode === "builtin") {
    await vm.extensionManager.loadExtensionURL(item.extensionId);
    return {extensionId: item.extensionId, alreadyLoaded: false};
  }

  if (!item.extensionURL) {
    throw new Error(`${item.name} の読み込みURLがありません`);
  }
  await loadExtensionModuleUrl(vm, item.extensionURL, item.extensionId);
  return {extensionId: item.extensionId, alreadyLoaded: false};
}

export async function loadExtensionModuleUrl(
  vm: ExtensionVm,
  url: string,
  expectedId?: string,
): Promise<string> {
  const mod = await importExtensionModule(url);
  const BlockClass = mod.blockClass;
  if (typeof BlockClass !== "function") {
    // Fall back to stock worker path for classic-script extensions.
    await vm.extensionManager.loadExtensionURL(url);
    return expectedId ?? url;
  }

  const instance = new BlockClass(vm.runtime);
  const info = instance.getInfo();
  const extensionId = info?.id || expectedId || mod.entry?.extensionId;
  if (!extensionId || typeof extensionId !== "string") {
    throw new Error("拡張機能の ID を取得できませんでした");
  }
  if (expectedId && extensionId !== expectedId) {
    throw new Error(
      `拡張機能 ID が一致しません（期待: ${expectedId}, 実際: ${extensionId}）`,
    );
  }
  if (vm.extensionManager.isExtensionLoaded(extensionId)) {
    return extensionId;
  }
  const serviceName = vm.extensionManager._registerInternalExtension(instance);
  vm.extensionManager._loadedExtensions.set(extensionId, serviceName);
  return extensionId;
}
