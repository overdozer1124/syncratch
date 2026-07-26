import {
  defaultExtensionCatalog,
  type DefaultExtensionEntry,
  type ExtensionKind,
} from "@blocksync/project-schema";
import {staticAssetUrl} from "./static-url.js";
import {
  isTurbowarpScriptUrl,
  loadTurbowarpExtensionScript,
} from "./turbowarp-scratch.js";
import {assertExtensionPrimitivesRegistered} from "./extension-toolbox.js";
import {
  topicsForExtensionKey,
  type ExtensionGalleryTopicId,
} from "./extension-gallery-filters.js";
import {ensureRuntimeFormatMessage} from "./xcratch-format-message.js";

export type ExtensionLoadMode = "builtin" | "module" | "loader" | "unavailable";

export interface ExtensionGalleryItem {
  key: string;
  extensionId: string | null;
  name: string;
  description: string;
  collaborator: string | null;
  extensionURL: string | null;
  iconURL: string | null;
  insetIconURL: string | null;
  kind: ExtensionKind;
  sources: string[];
  /** Use-case topics for gallery filter tabs. */
  topics: ExtensionGalleryTopicId[];
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
  editingTarget?: unknown;
  emit?: (event: string, payload?: unknown) => void;
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
  keyEvents: "キーイベント",
  httpRequest: "HTTPリクエスト",
  voice: "ボイス",
  xcxMesh: "メッシュ",
  xcxMPHand: "MediaPipe Hand",
  xcxVPen: "ベクトルペン",
  xcxml: "機械学習（xcx-ml）",
  poweredup: "LEGO Powered UP",
  legoremote: "LEGO Powered UP リモコン",
  controlplus: "LEGO Technic CONTROL+",
  legomario: "LEGO Mario",
  legoluigi: "LEGO Luigi",
  legopeach: "LEGO Peach",
  spikeessential: "SPIKE Essential",
  legoble: "LEGO BLE",
  fetch: "フェッチ",
  griffpatch: "Box2D 物理",
  files: "ファイル",
  skyhigh173JSON: "JSON",
  localstorage: "ローカルストレージ",
  Gamepad: "ゲームパッド",
  stretch: "ストレッチ",
  strings: "テキスト",
  text: "アニメーションテキスト",
  utilities: "ユーティリティ",
  clipboard: "クリップボード",
  cloudlink: "CloudLink",
  runtimeoptions: "ランタイムオプション",
  betterpen: "Pen+",
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
  keyEvents: "キーが押されているあいだのイベントを扱う。",
  httpRequest: "HTTP でデータを送受信する。",
  voice: "音声認識や合成を使う。",
  xcxMesh: "複数端末でデータを共有する。",
  xcxMPHand: "MediaPipe で手を検出する。",
  xcxVPen: "ベクトルで線を描く。",
  xcxml: "機械学習モデルを Scratch から使う。",
  poweredup: "LEGO Powered UP ハブを動かす。",
  legoremote: "LEGO Powered UP リモコンを使う。",
  controlplus: "LEGO Technic CONTROL+ ハブを動かす。",
  legomario: "LEGO Mario とつなぐ。",
  legoluigi: "LEGO Luigi とつなぐ。",
  legopeach: "LEGO Peach とつなぐ。",
  spikeessential: "SPIKE Essential ハブを動かす。",
  legoble: "汎用の LEGO BLE デバイスとつなぐ。",
  fetch: "インターネットへ HTTP リクエストする。",
  griffpatch: "Box2D で物理シミュレーションする。",
  files: "ファイルの読み書きとダウンロード。",
  skyhigh173JSON: "JSON を読み書き・加工する。",
  localstorage: "ブラウザにデータを保存する。",
  Gamepad: "ゲームパッドの入力を読む。",
  stretch: "スプライトの縦横比を変える。",
  strings: "文字列操作の便利ブロック。",
  text: "ステージにアニメーション文字を出す。",
  utilities: "便利な汎用ブロック集。",
  clipboard: "クリップボードとやりとりする。",
  cloudlink: "WebSocket でリアルタイム通信する。",
  runtimeoptions: "フレームレートなど実行設定を変える。",
  betterpen: "高機能なペンで描画する。",
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
    }
    return {
      key,
      extensionId: entry.extensionId,
      name: NAME_JA[key] ?? entry.name,
      description: DESC_JA[key] ?? entry.description,
      collaborator: entry.collaborator,
      extensionURL: entry.extensionURL,
      iconURL: entry.iconURL ?? null,
      insetIconURL: entry.insetIconURL ?? null,
      kind: entry.kind,
      sources: [...entry.sources],
      topics: topicsForExtensionKey(key),
      loadMode,
      statusNote,
    };
  });
}

type ExtensionModuleImporter = (
  url: string,
) => Promise<XcratchExtensionModule>;

const ML5_EXTENSION_IDS = new Set([
  "facemesh2scratch",
  "handpose2scratch",
  "ic2scratch",
]);

const ML5_CDN_URL = "https://unpkg.com/ml5@0.12.2/dist/ml5.min.js";

let ml5LoadPromise: Promise<void> | null = null;

/** Resolve catalog-relative asset/module URLs against the app base path. */
export function resolveExtensionModuleUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
    return url;
  }
  const publicPath =
    (typeof window !== "undefined" &&
      (window as Window & {__BLOCKSYNC_GUI_PUBLIC_PATH__?: string})
        .__BLOCKSYNC_GUI_PUBLIC_PATH__) ||
    import.meta.env.BASE_URL ||
    "/";
  const resolved = staticAssetUrl(url, publicPath);
  if (typeof window !== "undefined" && window.location?.href) {
    return new URL(resolved, window.location.href).href;
  }
  return resolved;
}

/** Resolve gallery icon paths the same way as module URLs. */
export function resolveExtensionIconUrl(url: string | null): string | null {
  if (!url) return null;
  return resolveExtensionModuleUrl(url);
}

export function ensureMl5Loaded(
  doc: Pick<Document, "createElement" | "head"> = document,
): Promise<void> {
  const g = globalThis as typeof globalThis & {ml5?: unknown};
  if (g.ml5) return Promise.resolve();
  if (ml5LoadPromise) return ml5LoadPromise;
  ml5LoadPromise = new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = ML5_CDN_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      ml5LoadPromise = null;
      reject(new Error("ml5 の読み込みに失敗しました"));
    };
    doc.head.appendChild(script);
  });
  return ml5LoadPromise;
}

/** Test-only seam to reset ml5 loader state. */
export function resetMl5LoaderForTests(): void {
  ml5LoadPromise = null;
  delete (globalThis as {ml5?: unknown}).ml5;
}

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

async function registerExtensionInstance(
  vm: ExtensionVm,
  instance: {getInfo(): {id: string; blocks?: unknown[]; color1?: string}},
  expectedId?: string,
  fallbackId?: string,
): Promise<string> {
  // Normalize before the VM reads getInfo during registration. Missing
  // color2/color3 (Animated Text) otherwise poison the Blockly theme and blank
  // the flyout for every category, not just the new extension.
  wrapTurbowarpExtensionObject(instance);
  const info = instance.getInfo();
  const extensionId = info?.id || expectedId || fallbackId;
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
  // Stock `_registerExtensionInfo` fires primitives via dispatch.call and only
  // log.errors failures — without this check the gallery can toast "added"
  // while the toolbox category never appears.
  assertExtensionPrimitivesRegistered(vm, extensionId);
  vm.extensionManager._loadedExtensions.set(extensionId, serviceName);
  return extensionId;
}

/**
 * Derive a darker companion colour when an extension only ships `color1`.
 * Animated Text (lab/text) omits color2/color3; stock GUI then calls
 * theme.setBlockStyle({colourSecondary: undefined}) and Blockly throws
 * `Invalid colour: "undefined"`, emptying the entire flyout.
 */
export function deriveExtensionCompanionColor(
  color: string,
  factor = 0.75,
): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map(ch => ch + ch)
      .join("");
  }
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
    return Math.max(0, Math.min(255, Math.round(value * factor)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/**
 * Stock Scratch VM has no BlockType.LABEL/XML. Map labels to separators so the
 * rest of the category still registers; drop raw XML entries.
 * Also strip TurboWarp-only Blockly extension hooks (e.g. colours_looks) that
 * stock scratch-blocks never registers — unknown hooks can leave workspace
 * blocks as icon-only husks that refuse to snap.
 * Always fill color2/color3 when color1 is present so GUI theme updates stay valid.
 */
export function normalizeTurbowarpExtensionInfo<
  T extends {
    blocks?: unknown[];
    color1?: string;
    color2?: string;
    color3?: string;
  },
>(info: T): T {
  if (!info) return info;
  const color1 =
    typeof info.color1 === "string" && info.color1 ? info.color1 : undefined;
  const color2 =
    (typeof info.color2 === "string" && info.color2) ||
    (color1 ? deriveExtensionCompanionColor(color1, 0.78) : undefined);
  const color3 =
    (typeof info.color3 === "string" && info.color3) ||
    (color2 ? deriveExtensionCompanionColor(color2, 0.78) : undefined);

  if (!Array.isArray(info.blocks)) {
    return {
      ...info,
      ...(color1 ? {color1, color2, color3} : {}),
    };
  }
  const blocks = info.blocks.flatMap(block => {
    if (block === "---") return [block];
    if (!block || typeof block !== "object") return [block];
    const blockType = (block as {blockType?: unknown}).blockType;
    if (blockType === "label") return ["---"];
    if (blockType === "xml") return [];
    if (!("extensions" in block)) return [block];
    const rest = {...(block as Record<string, unknown>)};
    delete rest.extensions;
    return [rest];
  });
  return {
    ...info,
    ...(color1 ? {color1, color2, color3} : {}),
    blocks,
  };
}

function wrapTurbowarpExtensionObject<T extends {getInfo(): {id: string; blocks?: unknown[]}}>(
  object: T,
): T {
  // Patch in place so prototype methods (opcodes) stay on the service object.
  const original = object.getInfo.bind(object);
  object.getInfo = () => normalizeTurbowarpExtensionInfo(original());
  return object;
}

async function loadTurbowarpExtensionUrl(
  vm: ExtensionVm,
  url: string,
  expectedId?: string,
): Promise<string> {
  const resolvedUrl = resolveExtensionModuleUrl(url);
  const objects = await loadTurbowarpExtensionScript(vm, resolvedUrl);
  if (!objects.length) {
    throw new Error("TurboWarp 拡張が register されませんでした");
  }
  let lastId = expectedId ?? resolvedUrl;
  for (const object of objects) {
    lastId = await registerExtensionInstance(vm, object, expectedId);
  }
  return lastId;
}

export async function loadExtensionModuleUrl(
  vm: ExtensionVm,
  url: string,
  expectedId?: string,
): Promise<string> {
  if (expectedId && ML5_EXTENSION_IDS.has(expectedId)) {
    await ensureMl5Loaded();
  }
  const resolvedUrl = resolveExtensionModuleUrl(url);
  if (isTurbowarpScriptUrl(resolvedUrl)) {
    return loadTurbowarpExtensionUrl(vm, resolvedUrl, expectedId);
  }

  let mod: XcratchExtensionModule;
  try {
    mod = await importExtensionModule(resolvedUrl);
  } catch {
    // Classic scripts (TurboWarp / blob URLs) are not ESM modules.
    return loadTurbowarpExtensionUrl(vm, resolvedUrl, expectedId);
  }

  const BlockClass = mod.blockClass;
  if (typeof BlockClass !== "function") {
    // Fall back to TurboWarp classic-script loader, then stock worker path.
    try {
      return await loadTurbowarpExtensionUrl(vm, resolvedUrl, expectedId);
    } catch {
      await vm.extensionManager.loadExtensionURL(resolvedUrl);
      return expectedId ?? resolvedUrl;
    }
  }

  // Xcratch modules call formatMessage.setup() via runtime.formatMessage.
  ensureRuntimeFormatMessage(vm.runtime);
  const instance = new BlockClass(vm.runtime);
  return registerExtensionInstance(
    vm,
    instance,
    expectedId,
    mod.entry?.extensionId,
  );
}
