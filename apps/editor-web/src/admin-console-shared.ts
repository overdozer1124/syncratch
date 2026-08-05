/** Shared DOM / autosave helpers for the 2a admin console rebuild. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "hidden" && value === "true") node.hidden = true;
    else node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function adminFetch<T>(
  path: string,
  init: RequestInit & {csrfToken?: string} = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (init.csrfToken) headers.set("x-csrf-token", init.csrfToken);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  return (await response.json()) as T;
}

export type AdminSaveState = "idle" | "saved" | "error";

export interface AdminSaveFooterController {
  root: HTMLElement;
  setIdle(): void;
  setSaved(): void;
  setError(message: string): void;
  pushUndo(action: () => void | Promise<void>): void;
  runUndo(): Promise<void>;
}

export function createAdminSaveFooter(): AdminSaveFooterController {
  const root = el("div", {class: "admin2-footer"});
  const status = el("span", {class: "admin2-footer-status"}, "● 変更なし");
  const undoBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-secondary admin2-btn-sm"},
    "元に戻す",
  ) as HTMLButtonElement;
  undoBtn.disabled = true;
  root.append(status, undoBtn);

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let undoStack: Array<() => void | Promise<void>> = [];

  function setIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    status.textContent = "● 変更なし";
    status.className = "admin2-footer-status";
  }

  function setSaved(): void {
    if (idleTimer) clearTimeout(idleTimer);
    status.textContent = "● 保存しました";
    status.className = "admin2-footer-status admin2-footer-status-saved";
    idleTimer = setTimeout(setIdle, 3000);
  }

  function setError(message: string): void {
    if (idleTimer) clearTimeout(idleTimer);
    status.textContent = `● ${message}`;
    status.className = "admin2-footer-status admin2-footer-status-error";
  }

  function pushUndo(action: () => void | Promise<void>): void {
    undoStack = [action];
    undoBtn.disabled = false;
  }

  async function runUndo(): Promise<void> {
    const action = undoStack.pop();
    undoBtn.disabled = undoStack.length === 0;
    if (action) await action();
    setIdle();
  }

  undoBtn.addEventListener("click", () => {
    void runUndo();
  });

  return {root, setIdle, setSaved, setError, pushUndo, runUndo};
}

export function emptyValue(text = "なし"): HTMLElement {
  return el("span", {class: "admin2-empty"}, text);
}

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

export function createSegmentControl<T extends string>(
  options: SegmentOption<T>[],
  selected: T,
  onChange: (value: T) => void,
): HTMLElement {
  const root = el("div", {class: "admin2-segment"});
  for (const option of options) {
    const btn = el(
      "button",
      {
        type: "button",
        class:
          option.value === selected
            ? "admin2-segment-btn is-selected"
            : "admin2-segment-btn",
      },
      option.label,
    ) as HTMLButtonElement;
    btn.addEventListener("click", () => {
      if (option.value === selected) return;
      onChange(option.value);
    });
    root.append(btn);
  }
  return root;
}

export function updateSegmentSelection(root: HTMLElement, selectedValue: string): void {
  for (const btn of root.querySelectorAll<HTMLButtonElement>(".admin2-segment-btn")) {
    const isSelected = btn.textContent === selectedValue;
    btn.classList.toggle("is-selected", isSelected);
  }
}

export function createBadge(
  text: string,
  variant: "success" | "neutral" | "warn" | "danger" | "info" = "neutral",
): HTMLElement {
  return el("span", {class: `admin2-badge admin2-badge-${variant}`}, text);
}

export interface FilePickerControl {
  root: HTMLElement;
  input: HTMLInputElement;
  setFileName(name: string | null): void;
}

export function createFilePicker(
  accept: string,
  buttonLabel: string,
  onFile: (file: File) => void,
): FilePickerControl {
  const root = el("div", {class: "admin2-file-picker"});
  const input = el("input", {
    type: "file",
    accept,
    class: "admin2-file-input-hidden",
  }) as HTMLInputElement;
  const name = el("span", {class: "admin2-file-name"}, "なし");
  const pickBtn = el(
    "button",
    {type: "button", class: "admin2-btn admin2-btn-secondary admin2-btn-sm"},
    buttonLabel,
  );
  pickBtn.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) {
      name.textContent = "なし";
      name.className = "admin2-file-name admin2-empty";
      return;
    }
    name.textContent = file.name;
    name.className = "admin2-file-name";
    onFile(file);
  });
  root.append(input, pickBtn, name);
  return {
    root,
    input,
    setFileName(fileName) {
      if (!fileName) {
        name.textContent = "なし";
        name.className = "admin2-file-name admin2-empty";
        return;
      }
      name.textContent = fileName;
      name.className = "admin2-file-name";
    },
  };
}

export function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

export function formatShortTimestamp(iso: string | null | undefined): string {
  if (!iso) return "なし";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}`;
}

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
