/**
 * Popover listing connected collab participants (avatar + display name).
 */

import type {CollabParticipantPresence} from "./collab-presence.js";

export const COLLAB_PRESENCE_POPOVER_ID = "collab-presence-popover";

export interface CollabPresencePopoverOptions {
  /** Draft value for the self nickname field (local profile, not Google). */
  localDisplayName?: string;
  /** Whether Google already supplies the self avatar/name. */
  googleProfileActive?: boolean;
  onSaveLocalName?: (name: string) => void;
}

export function shouldShowLocalPresenceEditor(options: {
  hasSelf: boolean;
  googleProfileActive?: boolean;
  canSaveLocalName?: boolean;
}): boolean {
  return Boolean(
    options.hasSelf && options.canSaveLocalName && !options.googleProfileActive,
  );
}

export function isCollabPresenceToggleTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const maybe = target as {
    closest?: (selector: string) => {dataset?: DOMStringMap} | null;
  };
  if (typeof maybe.closest !== "function") return false;
  const chip = maybe.closest("[data-status-id]");
  const id = chip?.dataset?.statusId;
  return id === "collab" || id === "avatar";
}

export function renderCollabPresencePopover(
  root: HTMLElement,
  participants: readonly CollabParticipantPresence[],
  options: CollabPresencePopoverOptions = {},
): void {
  root.replaceChildren();
  root.hidden = participants.length === 0;

  const title = document.createElement("p");
  title.className = "collab-presence-title";
  title.textContent = `つながっている人（${participants.length}）`;
  root.append(title);

  const list = document.createElement("ul");
  list.className = "collab-presence-list";
  list.setAttribute("role", "list");

  for (const person of participants) {
    const item = document.createElement("li");
    item.className = "collab-presence-item";
    if (person.isRoomHost) item.classList.add("collab-presence-item--host");
    if (person.isSelf) item.classList.add("collab-presence-item--self");

    const avatar = document.createElement("span");
    avatar.className = "collab-presence-avatar";
    avatar.setAttribute("aria-hidden", "true");
    if (person.avatarUrl) {
      const img = document.createElement("img");
      img.src = person.avatarUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.draggable = false;
      avatar.append(img);
    } else {
      avatar.classList.add("collab-presence-avatar--placeholder");
      avatar.textContent = person.displayName.slice(0, 1);
    }
    item.append(avatar);

    const meta = document.createElement("span");
    meta.className = "collab-presence-meta";
    const name = document.createElement("span");
    name.className = "collab-presence-name";
    name.textContent = person.displayName;
    meta.append(name);
    if (person.isRoomHost || person.isSelf) {
      const tags = document.createElement("span");
      tags.className = "collab-presence-tags";
      if (person.isRoomHost) {
        const host = document.createElement("span");
        host.className = "collab-presence-tag collab-presence-tag--host";
        host.textContent = "ホスト";
        tags.append(host);
      }
      if (person.isSelf) {
        const self = document.createElement("span");
        self.className = "collab-presence-tag";
        self.textContent = "じぶん";
        tags.append(self);
      }
      meta.append(tags);
    }
    item.append(meta);
    list.append(item);
  }

  root.append(list);

  const self = participants.find(person => person.isSelf);
  if (
    shouldShowLocalPresenceEditor({
      hasSelf: Boolean(self),
      googleProfileActive: options.googleProfileActive,
      canSaveLocalName: typeof options.onSaveLocalName === "function",
    })
  ) {
    const editor = document.createElement("div");
    editor.className = "collab-presence-edit";

    const label = document.createElement("label");
    label.className = "collab-presence-edit-label";
    label.htmlFor = "collab-local-display-name";
    label.textContent = "じぶんのなまえ（みんなに見える）";

    const row = document.createElement("div");
    row.className = "collab-presence-edit-row";

    const input = document.createElement("input");
    input.id = "collab-local-display-name";
    input.className = "collab-presence-edit-input";
    input.type = "text";
    input.maxLength = 24;
    input.setAttribute("autocomplete", "nickname");
    input.placeholder = "例：みらい";
    input.value = options.localDisplayName ?? "";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "collab-presence-edit-save";
    button.textContent = "けってい";

    const hint = document.createElement("p");
    hint.className = "collab-presence-edit-hint";
    hint.textContent =
      "Google なしでもアイコンが変わります。Google とつなぐと写真も使えます（保存はホストだけ）。";

    const save = (): void => {
      options.onSaveLocalName?.(input.value);
    };
    button.addEventListener("click", save);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
    });

    row.append(input, button);
    editor.append(label, row, hint);
    root.append(editor);
  }
}

export function setCollabPresencePopoverOpen(
  root: HTMLElement,
  open: boolean,
): void {
  root.classList.toggle("is-open", open);
  root.hidden = !open;
  root.setAttribute("aria-hidden", open ? "false" : "true");
}

export function toggleCollabPresencePopover(root: HTMLElement): boolean {
  const next = !root.classList.contains("is-open");
  setCollabPresencePopoverOpen(root, next);
  return next;
}
