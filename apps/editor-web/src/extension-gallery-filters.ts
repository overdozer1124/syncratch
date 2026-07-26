import type {ExtensionGalleryItem} from "./extension-gallery.js";

/**
 * Use-case topics for the gallery filter tabs.
 * An extension may belong to multiple topics.
 */
export type ExtensionGalleryTopicId =
  | "ml"
  | "sensing"
  | "board"
  | "design"
  | "network"
  | "sound"
  | "other";

export type ExtensionGalleryFilterId = "all" | ExtensionGalleryTopicId;

export type ExtensionGalleryFilter = {
  id: ExtensionGalleryFilterId;
  label: string;
  /** Topic to match; null means show everything. */
  topic: ExtensionGalleryTopicId | null;
};

export const EXTENSION_GALLERY_FILTERS: readonly ExtensionGalleryFilter[] = [
  {id: "all", label: "すべて", topic: null},
  {id: "ml", label: "機械学習・AI", topic: "ml"},
  {id: "sensing", label: "計測・制御", topic: "sensing"},
  {id: "board", label: "拡張ボード・ロボット", topic: "board"},
  {id: "design", label: "イラスト・デザイン", topic: "design"},
  {id: "network", label: "ネット・データ", topic: "network"},
  {id: "sound", label: "サウンド・ことば", topic: "sound"},
  {id: "other", label: "その他", topic: "other"},
] as const;

/**
 * Explicit topic tags per gallery key (`extensionId` or `catalogId`).
 * Keys omitted here fall back to `other`.
 */
const TOPICS_BY_KEY: Record<string, readonly ExtensionGalleryTopicId[]> = {
  // 機械学習・AI
  ml2scratch: ["ml"],
  posenet2scratch: ["ml"],
  tm2scratch: ["ml"],
  tmpose2scratch: ["ml"],
  facemesh2scratch: ["ml"],
  handpose2scratch: ["ml"],
  ic2scratch: ["ml"],
  xcxml: ["ml"],
  xcxMPHand: ["ml", "sensing"],
  chatgpt2scratch: ["ml"],
  gai: ["ml"],

  // 計測・制御
  videoSensing: ["sensing"],
  gdxfor: ["sensing"],
  Gamepad: ["sensing"],
  keyEvents: ["sensing"],
  pasorich: ["sensing"],
  qrcode: ["sensing"],
  cameraselector: ["sensing"],
  voice: ["sensing", "sound"],
  speech2scratch: ["sensing", "sound", "ml"],

  // 拡張ボード・ロボット
  makeymakey: ["board"],
  microbit: ["board"],
  microbitMore: ["board"],
  ev3: ["board"],
  boost: ["board"],
  wedo2: ["board"],
  g2s: ["board", "sensing"],
  scratch2maqueen: ["board"],
  xcxArduino: ["board"],
  scratch2webserialapi: ["board", "network"],
  duplotrain: ["board"],
  poweredup: ["board"],
  legoremote: ["board"],
  controlplus: ["board"],
  legomario: ["board"],
  legoluigi: ["board"],
  legopeach: ["board"],
  spikeessential: ["board"],
  legoble: ["board"],

  // イラスト・デザイン
  pen: ["design"],
  betterpen: ["design"],
  stretch: ["design"],
  text: ["design"],
  xcxVPen: ["design"],
  screenshot: ["design"],
  strings: ["design", "other"],

  // ネット・データ
  fetch: ["network"],
  httpRequest: ["network"],
  files: ["network"],
  skyhigh173JSON: ["network"],
  localstorage: ["network"],
  clipboard: ["network"],
  cloudlink: ["network"],
  iftttWebhooks: ["network"],
  numberbank: ["network"],
  webapiExtension: ["network"],
  xcxMesh: ["network"],
  geoscratch: ["network"],

  // サウンド・ことば
  music: ["sound"],
  text2speech: ["sound"],
  translate: ["sound"],

  // その他（ゲーム・物理・ランタイム・ローダーなど）
  griffpatch: ["other"],
  utilities: ["other"],
  runtimeoptions: ["other"],
  extensionLoader: ["other"],
};

export function topicsForExtensionKey(
  key: string,
): ExtensionGalleryTopicId[] {
  const topics = TOPICS_BY_KEY[key];
  if (topics && topics.length > 0) {
    return [...topics];
  }
  return ["other"];
}

export function isExtensionGalleryFilterId(
  value: string,
): value is ExtensionGalleryFilterId {
  return EXTENSION_GALLERY_FILTERS.some(filter => filter.id === value);
}

export function filterMatchesItem(
  filter: ExtensionGalleryFilter,
  item: Pick<ExtensionGalleryItem, "topics">,
): boolean {
  if (!filter.topic) return true;
  return item.topics.includes(filter.topic);
}

export function filterExtensionGalleryItems(
  items: readonly ExtensionGalleryItem[],
  filterId: ExtensionGalleryFilterId,
): ExtensionGalleryItem[] {
  const filter =
    EXTENSION_GALLERY_FILTERS.find(entry => entry.id === filterId) ??
    EXTENSION_GALLERY_FILTERS[0]!;
  return items.filter(item => filterMatchesItem(filter, item));
}

export function countItemsForFilter(
  items: readonly ExtensionGalleryItem[],
  filterId: ExtensionGalleryFilterId,
): number {
  return filterExtensionGalleryItems(items, filterId).length;
}
