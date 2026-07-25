import {
  buildExtensionGalleryItems,
  loadGalleryExtension,
  type ExtensionGalleryItem,
  type ExtensionVm,
} from "./extension-gallery.js";

export type ExtensionGalleryController = {
  open(): void;
  close(): void;
  isOpen(): boolean;
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
      <p class="extension-gallery-help">
        Stretch3 / Xcratch のデフォルト拡張を含む一覧です。タップすると作品に追加されます。
      </p>
      <div class="extension-gallery-grid" data-testid="extension-gallery-grid"></div>
    </div>
  `;

  const grid = overlay.querySelector<HTMLElement>(".extension-gallery-grid")!;
  const closeButton = overlay.querySelector<HTMLButtonElement>(
    ".extension-gallery-close",
  )!;

  function render(): void {
    grid.replaceChildren();
    for (const item of items) {
      grid.append(renderCard(item));
    }
  }

  function renderCard(item: ExtensionGalleryItem): HTMLElement {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "extension-gallery-card";
    button.dataset.extensionKey = item.key;
    button.disabled =
      item.loadMode === "unavailable" || loadingKey === item.key;

    const sources = item.sources
      .map(source => {
        if (source === "stretch3") return "Stretch3";
        if (source === "xcratch") return "Xcratch";
        if (source === "scratch-foundation") return "Scratch";
        return source;
      })
      .join(" · ");

    button.innerHTML = `
      <span class="extension-gallery-card-name"></span>
      <span class="extension-gallery-card-desc"></span>
      <span class="extension-gallery-card-meta"></span>
    `;
    button.querySelector(".extension-gallery-card-name")!.textContent =
      item.name;
    button.querySelector(".extension-gallery-card-desc")!.textContent =
      item.description;
    const metaBits = [sources];
    if (item.collaborator) metaBits.push(item.collaborator);
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
      options.onError?.("エディターの準備がまだです");
      return;
    }
    if (item.loadMode === "unavailable") {
      options.onError?.(
        `${item.name} は一覧に入っていますが、まだこの環境では読み込めません`,
      );
      return;
    }

    loadingKey = item.key;
    render();
    try {
      const result = await loadGalleryExtension(vm, item, {
        promptUrl: () =>
          options.promptUrl?.(
            "読み込む拡張機能の URL を入力してください（.mjs など）",
          ) ?? null,
      });
      if (item.loadMode === "loader" && !result.alreadyLoaded && result.extensionId === null) {
        // User cancelled the prompt.
        return;
      }
      options.onLoaded?.(result.extensionId, result.alreadyLoaded);
      close();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "不明なエラー");
      options.onError?.(`${item.name} を読み込めませんでした: ${message}`);
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
    }
  };
  documentRef.addEventListener("keydown", onKeyDown);

  render();

  return {
    open: openGallery,
    close,
    isOpen: () => open,
    dispose: () => {
      documentRef.removeEventListener("keydown", onKeyDown);
      close();
      overlay.remove();
    },
  };
}
