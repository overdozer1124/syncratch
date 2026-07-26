import {
  buildExtensionGalleryItems,
  loadGalleryExtension,
  resolveExtensionIconUrl,
  type ExtensionGalleryItem,
  type ExtensionVm,
} from "./extension-gallery.js";
import {
  countItemsForFilter,
  EXTENSION_GALLERY_FILTERS,
  filterExtensionGalleryItems,
  isExtensionGalleryFilterId,
  type ExtensionGalleryFilterId,
} from "./extension-gallery-filters.js";

export type ExtensionGalleryController = {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Active filter id (for tests / debugging). */
  getFilter(): ExtensionGalleryFilterId;
  setFilter(filterId: ExtensionGalleryFilterId): void;
  dispose(): void;
};

export function createExtensionGalleryUi(options: {
  documentRef?: Document;
  getVm: () => ExtensionVm | null | undefined;
  onLoaded?: (extensionId: string | null, alreadyLoaded: boolean) => void;
  onError?: (message: string) => void;
  promptUrl?: (message: string) => string | null;
}): ExtensionGalleryController {
  const documentRef = options.documentRef ?? document;
  const items = buildExtensionGalleryItems();
  let open = false;
  let loadingKey: string | null = null;
  let activeFilter: ExtensionGalleryFilterId = "all";

  const overlay = documentRef.createElement("div");
  overlay.className = "extension-gallery-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "extension-gallery-title");

  overlay.innerHTML = `
    <div class="extension-gallery-panel">
      <header class="extension-gallery-header">
        <h2 id="extension-gallery-title">拡張機能を選ぶ</h2>
        <button type="button" class="extension-gallery-close" aria-label="閉じる">×</button>
      </header>
      <div class="extension-gallery-body">
        <nav
          class="extension-gallery-filters"
          role="tablist"
          aria-label="拡張機能の用途で絞り込み"
          aria-orientation="vertical"
          data-testid="extension-gallery-filters"
        ></nav>
        <div class="extension-gallery-main">
          <p class="extension-gallery-status" hidden data-testid="extension-gallery-status"></p>
          <div class="extension-gallery-grid" data-testid="extension-gallery-grid"></div>
        </div>
      </div>
    </div>
  `;

  const filtersEl = overlay.querySelector<HTMLElement>(
    ".extension-gallery-filters",
  )!;
  const grid = overlay.querySelector<HTMLElement>(".extension-gallery-grid")!;
  const statusEl = overlay.querySelector<HTMLElement>(".extension-gallery-status")!;
  const closeButton = overlay.querySelector<HTMLButtonElement>(
    ".extension-gallery-close",
  )!;

  function setStatus(message: string | null): void {
    if (message) {
      statusEl.hidden = false;
      statusEl.textContent = message;
    } else {
      statusEl.hidden = true;
      statusEl.textContent = "";
    }
  }

  function visibleItems(): ExtensionGalleryItem[] {
    return filterExtensionGalleryItems(items, activeFilter);
  }

  function renderFilters(): void {
    filtersEl.replaceChildren();
    for (const filter of EXTENSION_GALLERY_FILTERS) {
      const count = countItemsForFilter(items, filter.id);
      if (filter.id !== "all" && count === 0) continue;

      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "extension-gallery-filter";
      button.dataset.filterId = filter.id;
      button.setAttribute("role", "tab");
      button.setAttribute(
        "aria-selected",
        filter.id === activeFilter ? "true" : "false",
      );
      button.tabIndex = filter.id === activeFilter ? 0 : -1;
      if (filter.id === activeFilter) {
        button.classList.add("is-active");
      }

      const label = documentRef.createElement("span");
      label.className = "extension-gallery-filter-label";
      label.textContent = filter.label;
      const countEl = documentRef.createElement("span");
      countEl.className = "extension-gallery-filter-count";
      countEl.textContent = String(count);
      button.append(label, countEl);

      button.addEventListener("click", () => {
        setFilter(filter.id);
      });
      filtersEl.append(button);
    }
  }

  function renderGrid(): void {
    grid.replaceChildren();
    const shown = visibleItems();
    if (shown.length === 0) {
      const empty = documentRef.createElement("p");
      empty.className = "extension-gallery-empty";
      empty.setAttribute("data-testid", "extension-gallery-empty");
      empty.textContent = "この分類には拡張機能がありません";
      grid.append(empty);
      return;
    }
    for (const item of shown) {
      grid.append(renderCard(item));
    }
  }

  function render(): void {
    renderFilters();
    renderGrid();
  }

  function setFilter(filterId: ExtensionGalleryFilterId): void {
    if (!isExtensionGalleryFilterId(filterId)) return;
    if (activeFilter === filterId) {
      renderFilters();
      return;
    }
    activeFilter = filterId;
    render();
    const active = filtersEl.querySelector<HTMLButtonElement>(
      `.extension-gallery-filter[data-filter-id="${filterId}"]`,
    );
    active?.focus();
  }

  function renderCard(item: ExtensionGalleryItem): HTMLElement {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "extension-gallery-card";
    button.dataset.extensionKey = item.key;
    button.disabled =
      item.loadMode === "unavailable" || loadingKey === item.key;

    const iconUrl = resolveExtensionIconUrl(item.iconURL);
    const insetUrl = resolveExtensionIconUrl(item.insetIconURL);

    button.innerHTML = `
      <span class="extension-gallery-card-media">
        ${
          iconUrl
            ? `<img class="extension-gallery-card-icon" alt="" decoding="async" />`
            : `<span class="extension-gallery-card-icon-fallback" aria-hidden="true"></span>`
        }
        ${
          insetUrl
            ? `<span class="extension-gallery-card-inset"><img alt="" decoding="async" /></span>`
            : ""
        }
      </span>
      <span class="extension-gallery-card-body">
        <span class="extension-gallery-card-name"></span>
        <span class="extension-gallery-card-desc"></span>
      </span>
      <span class="extension-gallery-card-meta"></span>
    `;

    const iconImg = button.querySelector<HTMLImageElement>(
      ".extension-gallery-card-icon",
    );
    if (iconImg && iconUrl) iconImg.src = iconUrl;
    const insetImg = button.querySelector<HTMLImageElement>(
      ".extension-gallery-card-inset img",
    );
    if (insetImg && insetUrl) insetImg.src = insetUrl;

    button.querySelector(".extension-gallery-card-name")!.textContent =
      item.name;
    button.querySelector(".extension-gallery-card-desc")!.textContent =
      item.description;

    const metaBits: string[] = [];
    if (item.collaborator) {
      metaBits.push(`協力: ${item.collaborator}`);
    }
    if (item.statusNote) metaBits.push(item.statusNote);
    if (loadingKey === item.key) metaBits.push("読み込み中…");
    button.querySelector(".extension-gallery-card-meta")!.textContent =
      metaBits.join(" · ");

    button.addEventListener("click", () => {
      void handleSelect(item);
    });
    return button;
  }

  async function handleSelect(item: ExtensionGalleryItem): Promise<void> {
    const vm = options.getVm();
    if (!vm) {
      const message = "エディターの準備がまだです";
      setStatus(message);
      options.onError?.(message);
      return;
    }
    if (item.loadMode === "unavailable") {
      const message = `${item.name} は一覧に入っていますが、まだこの環境では読み込めません`;
      setStatus(message);
      options.onError?.(message);
      return;
    }

    loadingKey = item.key;
    setStatus(`${item.name} を読み込んでいます…`);
    render();
    try {
      const result = await loadGalleryExtension(vm, item, {
        promptUrl: () =>
          options.promptUrl?.(
            "読み込む拡張機能の URL を入力してください（.mjs など）",
          ) ?? null,
      });
      if (
        item.loadMode === "loader" &&
        !result.alreadyLoaded &&
        result.extensionId === null
      ) {
        setStatus(null);
        return;
      }
      setStatus(null);
      options.onLoaded?.(result.extensionId, result.alreadyLoaded);
      close();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "不明なエラー");
      const full = `${item.name} を読み込めませんでした: ${message}`;
      setStatus(full);
      options.onError?.(full);
    } finally {
      loadingKey = null;
      if (open) render();
    }
  }

  function openGallery(): void {
    if (!overlay.isConnected) {
      documentRef.body.append(overlay);
    }
    open = true;
    overlay.hidden = false;
    setStatus(null);
    documentRef.body.classList.add("syncratch-extension-gallery-open");
    render();
    closeButton.focus();
  }

  function close(): void {
    open = false;
    overlay.hidden = true;
    documentRef.body.classList.remove("syncratch-extension-gallery-open");
  }

  closeButton.addEventListener("click", () => close());
  overlay.addEventListener("click", event => {
    if (event.target === overlay) close();
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    // Vertical sidebar: prefer Up/Down; keep Left/Right as aliases.
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight"
    ) {
      return;
    }
    const tabs = [...filtersEl.querySelectorAll<HTMLButtonElement>(
      ".extension-gallery-filter",
    )];
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex(
      tab => tab.dataset.filterId === activeFilter,
    );
    if (currentIndex < 0) return;
    event.preventDefault();
    const delta =
      event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const next =
      tabs[(currentIndex + delta + tabs.length) % tabs.length];
    const nextId = next?.dataset.filterId;
    if (nextId && isExtensionGalleryFilterId(nextId)) {
      setFilter(nextId);
    }
  };
  documentRef.addEventListener("keydown", onKeyDown);

  render();

  return {
    open: openGallery,
    close,
    isOpen: () => open,
    getFilter: () => activeFilter,
    setFilter,
    dispose: () => {
      documentRef.removeEventListener("keydown", onKeyDown);
      close();
      overlay.remove();
    },
  };
}
