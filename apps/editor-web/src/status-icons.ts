import {collabRoomRole, collabRoomRoleLabel} from "./collab-role-ui.js";
import type {EditorDriveStatus} from "./drive-integration.js";
import {
  collaborationStatusText,
  composeProjectStatus,
  type ProjectStatusInput,
} from "./project-status.js";
import type {LocalSaveState} from "./save-coordinator.js";
import {staticAssetUrl} from "./static-url.js";

/**
 * Official Google Drive product mark (2026 color), vendored from gstatic for
 * offline/CSP-safe toolbar recognition. Used only to indicate Drive status.
 */
export const GOOGLE_DRIVE_STATUS_ICON_PATH =
  "branding/google-drive-2026-color-64dp.png";

export type StatusIconTone = "ok" | "warn" | "error" | "muted" | "busy" | "active";

export type StatusIconKind = "local" | "drive" | "online" | "avatar";

export interface StatusAvatarFace {
  label: string;
  imageUrl?: string;
  hostRing?: boolean;
}

export interface StatusIconChip {
  id: "local" | "drive" | "collab" | "avatar";
  kind: StatusIconKind;
  /** Full explanation for tooltip / aria-label. */
  label: string;
  tone: StatusIconTone;
  /** Optional count badge, e.g. "2" or "×5". */
  badge?: string;
  /** Crown mark on the online pill when this peer is the room host. */
  showCrown?: boolean;
  /** Google profile picture for a single avatar chip. */
  imageUrl?: string;
  /** Red host ring around the avatar (Scratch-style). */
  hostRing?: boolean;
  /** Stacked faces for the connected roster preview (max ~3). */
  faces?: StatusAvatarFace[];
}

const localStatusText: Record<LocalSaveState, string> = {
  clean: "このパソコンに保存しました",
  dirty: "変更を保存します…",
  saving: "このパソコンに保存中…",
  error: "このパソコンに保存できませんでした",
  conflict: "もう一度保存してください",
};

const driveDetailText: Record<EditorDriveStatus, string | null> = {
  "not-configured": null,
  disconnected: "Google ドライブ：つながっていません",
  connected: "Google ドライブにつながりました",
  syncing: "Google ドライブに保存中…",
  synced: "Google ドライブにも保存しました",
  unsynced: "Google ドライブにはまだ保存していません",
  conflict: "Google ドライブの作品が別の場所で変わっています",
};

function localTone(state: LocalSaveState): StatusIconTone {
  if (state === "clean") return "ok";
  if (state === "error" || state === "conflict") return "error";
  return "busy";
}

function driveTone(status: EditorDriveStatus): StatusIconTone {
  switch (status) {
    case "synced":
    case "connected":
      return "active";
    case "syncing":
      return "busy";
    case "unsynced":
      return "warn";
    case "conflict":
      return "error";
    default:
      return "muted";
  }
}

/** Cap visible headcount; beyond this show ×N on one avatar. */
export const STATUS_PEOPLE_ICON_CAP = 4;

export function formatPeopleBadge(participantCount: number): string {
  if (participantCount <= STATUS_PEOPLE_ICON_CAP) {
    return String(participantCount);
  }
  return `×${participantCount}`;
}

export function composeStatusIcons(input: ProjectStatusInput): StatusIconChip[] {
  const icons: StatusIconChip[] = [];

  if (input.fatalError) {
    icons.push({
      id: "local",
      kind: "local",
      label: input.fatalError,
      tone: "error",
    });
    return icons;
  }

  icons.push({
    id: "local",
    kind: "local",
    label: input.localError ?? localStatusText[input.local],
    tone: input.localError ? "error" : localTone(input.local),
  });

  const driveLabel = input.driveMessage
    ? `${driveDetailText[input.drive] ?? "Google ドライブ"}：${input.driveMessage}`
    : driveDetailText[input.drive];
  if (driveLabel) {
    icons.push({
      id: "drive",
      kind: "drive",
      label: driveLabel,
      tone: driveTone(input.drive),
    });
  }

  if (input.collab) {
    const collabLabel = collaborationStatusText(input.collab);
    const participantCount = Math.max(1, input.collab.peerCount + 1);
    const waiting =
      input.collab.status === "connected" &&
      input.collab.bootstrapPhase === "ready" &&
      input.collab.peerCount === 0;
    const role = collabRoomRole(input.collab);
    const isHost = role === "host";
    const tone: StatusIconTone =
      input.collab.status === "disconnected" || input.collab.signalingError
        ? "error"
        : input.collab.status === "connecting" ||
            input.collab.bootstrapPhase !== "ready"
          ? "busy"
          : waiting
            ? "warn"
            : "active";

    icons.push({
      id: "collab",
      kind: "online",
      // collabLabel already includes the host/guest role via appendCollabRoomRole.
      label: `${collabLabel} · クリックで一覧`,
      tone,
      showCrown: Boolean(isHost && input.collab.status !== "disconnected"),
    });

    if (input.collab.status !== "disconnected") {
      const roster = input.collab.participants ?? [];
      const faces: StatusAvatarFace[] = (roster.length > 0
        ? roster
        : [
            {
              participantId: "self",
              displayName: isHost
                ? collabRoomRoleLabel("host")
                : role
                  ? collabRoomRoleLabel(role)
                  : "じぶん",
              avatarUrl: input.googleAvatarUrl,
              isSelf: true,
              isRoomHost: Boolean(isHost),
            },
          ]
      )
        .slice(0, 3)
        .map(person => ({
          label: person.displayName,
          imageUrl: person.avatarUrl,
          hostRing: person.isRoomHost,
        }));

      icons.push({
        id: "avatar",
        kind: "avatar",
        label: `つながっている人 ${participantCount}人 · クリックで一覧`,
        tone: isHost ? "active" : "ok",
        badge: formatPeopleBadge(participantCount),
        imageUrl: faces[0]?.imageUrl ?? input.googleAvatarUrl,
        hostRing: Boolean(faces[0]?.hostRing),
        faces,
      });
    }
  }

  return icons;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(
  name: string,
  attrs: Record<string, string>,
  children: SVGElement[] = [],
): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function crownGlyph(): SVGElement {
  return svgEl(
    "svg",
    {
      class: "status-online-crown",
      viewBox: "0 0 24 24",
      fill: "currentColor",
      stroke: "none",
      "aria-hidden": "true",
      focusable: "false",
    },
    [
      svgEl("path", {
        d: "M4 16 6.5 8l3.5 4L12 6l2 6 3.5-4L20 16H4zm1 2h14v2H5z",
      }),
    ],
  );
}

function personGlyph(): SVGElement {
  return svgEl(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    [
      svgEl("circle", {cx: "12", cy: "8", r: "3.2"}),
      svgEl("path", {d: "M5.5 19c1.4-3.2 3.6-4.5 6.5-4.5s5.1 1.3 6.5 4.5"}),
    ],
  );
}

function localGlyph(): SVGElement {
  return svgEl(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    [
      svgEl("path", {
        d: "M4 7h12l4 4v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z",
      }),
      svgEl("path", {d: "M14 7v5h5"}),
      svgEl("path", {d: "M8 17h4"}),
    ],
  );
}

function driveLogoImage(): HTMLImageElement {
  const image = document.createElement("img");
  image.className = "status-icon-drive-logo";
  image.src = staticAssetUrl(GOOGLE_DRIVE_STATUS_ICON_PATH);
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  image.setAttribute("aria-hidden", "true");
  return image;
}

function avatarImage(url: string): HTMLImageElement {
  const image = document.createElement("img");
  image.className = "status-icon-avatar-img";
  image.src = url;
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.decoding = "async";
  image.draggable = false;
  image.setAttribute("aria-hidden", "true");
  return image;
}

function renderOnlineChip(chip: StatusIconChip): HTMLElement {
  const label = document.createElement("span");
  label.className = "status-online-label";
  if (chip.showCrown) {
    label.append(crownGlyph());
  }
  const text = document.createElement("span");
  text.className = "status-online-text";
  text.textContent = "online";
  label.append(text);
  return label;
}

export function renderStatusIconRow(
  root: HTMLElement,
  icons: StatusIconChip[],
): void {
  root.replaceChildren();
  for (const chip of icons) {
    const item = document.createElement("span");
    const hostClass = chip.hostRing ? " status-icon--host" : "";
    item.className =
      `status-icon status-icon--${chip.kind} status-icon--${chip.tone}${hostClass}`;
    item.dataset.statusId = chip.id;
    item.dataset.testid = `status-icon-${chip.id}`;
    item.setAttribute("role", "img");
    item.setAttribute("aria-label", chip.label);
    item.title = chip.label;
    item.tabIndex = 0;

    if (chip.kind === "drive") {
      item.append(driveLogoImage());
    } else if (chip.kind === "online") {
      item.append(renderOnlineChip(chip));
    } else if (chip.kind === "avatar") {
      const faces = chip.faces && chip.faces.length > 0
        ? chip.faces
        : [
            {
              label: chip.label,
              imageUrl: chip.imageUrl,
              hostRing: chip.hostRing,
            },
          ];
      if (faces.length === 1) {
        const face = faces[0]!;
        item.append(face.imageUrl ? avatarImage(face.imageUrl) : personGlyph());
      } else {
        item.classList.add("status-icon--avatar-stack");
        const stack = document.createElement("span");
        stack.className = "status-avatar-stack";
        stack.setAttribute("aria-hidden", "true");
        for (const face of faces) {
          const faceEl = document.createElement("span");
          faceEl.className = "status-avatar-stack-face";
          if (face.hostRing) faceEl.classList.add("status-avatar-stack-face--host");
          if (face.imageUrl) faceEl.append(avatarImage(face.imageUrl));
          else faceEl.append(personGlyph());
          stack.append(faceEl);
        }
        item.append(stack);
      }
    } else {
      item.append(localGlyph());
    }

    if (chip.badge) {
      const badge = document.createElement("span");
      badge.className = "status-icon-badge";
      badge.textContent = chip.badge;
      badge.setAttribute("aria-hidden", "true");
      item.append(badge);
    }
    root.append(item);
  }
}

/** Text + icons for toolbar rendering and tests. */
export function composeProjectStatusView(input: ProjectStatusInput): {
  primary: string;
  details: string;
  icons: StatusIconChip[];
} {
  const text = composeProjectStatus(input);
  return {
    ...text,
    icons: composeStatusIcons(input),
  };
}
