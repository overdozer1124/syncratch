import type {ExtensionGalleryItem} from "./extension-gallery.js";

/** Gallery filter tabs keyed by catalog `sources`. */
export type ExtensionGalleryFilterId =
  | "all"
  | "scratch"
  | "xcratch"
  | "turbowarp"
  | "stretch3";

export type ExtensionGalleryFilter = {
  id: ExtensionGalleryFilterId;
  label: string;
  /** Catalog source to match; null means show everything. */
  source: string | null;
};

export const EXTENSION_GALLERY_FILTERS: readonly ExtensionGalleryFilter[] = [
  {id: "all", label: "すべて", source: null},
  {id: "scratch", label: "Scratch", source: "scratch-foundation"},
  {id: "xcratch", label: "Xcratch", source: "xcratch"},
  {id: "turbowarp", label: "TurboWarp", source: "turbowarp"},
  {id: "stretch3", label: "Stretch3", source: "stretch3"},
] as const;

export function isExtensionGalleryFilterId(
  value: string,
): value is ExtensionGalleryFilterId {
  return EXTENSION_GALLERY_FILTERS.some(filter => filter.id === value);
}

export function filterMatchesItem(
  filter: ExtensionGalleryFilter,
  item: Pick<ExtensionGalleryItem, "sources">,
): boolean {
  if (!filter.source) return true;
  return item.sources.includes(filter.source);
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
