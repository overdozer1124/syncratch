/**
 * Browser-local collab display name + generated avatar (no Google / Drive required).
 * Synced to peers via awareness `setLocalProfile`, not into the project document.
 */

export const LOCAL_COLLAB_PROFILE_STORAGE_KEY = "syncratch.collabLocalProfile.v1";

export interface LocalCollabProfile {
  displayName: string;
}

const AVATAR_PALETTE = [
  "#0f766e", // teal
  "#b45309", // amber
  "#be123c", // rose
  "#1d4ed8", // blue
  "#15803d", // green
  "#c2410c", // orange
  "#0e7490", // cyan
  "#a16207", // gold
] as const;

export function normalizeLocalDisplayName(raw: string | undefined | null): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 24);
}

export function loadLocalCollabProfile(
  storage: Pick<Storage, "getItem"> | null | undefined = defaultStorage(),
): LocalCollabProfile | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCAL_COLLAB_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {displayName?: unknown};
    const displayName = normalizeLocalDisplayName(
      typeof parsed.displayName === "string" ? parsed.displayName : "",
    );
    if (!displayName) return null;
    return {displayName};
  } catch {
    return null;
  }
}

export function saveLocalCollabProfile(
  profile: LocalCollabProfile,
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined = defaultStorage(),
): LocalCollabProfile | null {
  if (!storage) return null;
  const displayName = normalizeLocalDisplayName(profile.displayName);
  if (!displayName) {
    try {
      storage.removeItem(LOCAL_COLLAB_PROFILE_STORAGE_KEY);
    } catch {
      // ignore quota / private mode
    }
    return null;
  }
  const next = {displayName};
  try {
    storage.setItem(LOCAL_COLLAB_PROFILE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Still return the in-memory profile even if persistence fails.
  }
  return next;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarColorForSeed(seed: string): string {
  return AVATAR_PALETTE[hashSeed(seed) % AVATAR_PALETTE.length]!;
}

/** Deterministic SVG avatar (initial + color) as a data URL for awareness. */
export function buildLocalAvatarDataUrl(seed: string, displayName: string): string {
  const label = normalizeLocalDisplayName(displayName) || "?";
  const initial = Array.from(label)[0] ?? "?";
  const fill = avatarColorForSeed(seed || label);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">` +
    `<rect width="64" height="64" rx="32" fill="${fill}"/>` +
    `<text x="32" y="34" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="M PLUS Rounded 1c, sans-serif" font-size="28" font-weight="800" fill="#fffef6">` +
    `${escapeXml(initial)}` +
    `</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Resolve what to advertise: Google profile wins when present, else local name
 * + generated avatar.
 */
export function resolveAdvertisedCollabProfile(input: {
  participantId: string;
  googleDisplayName?: string;
  googleAvatarUrl?: string;
  localDisplayName?: string;
}): {displayName?: string; avatarUrl?: string} {
  const googleName = normalizeLocalDisplayName(input.googleDisplayName);
  const localName = normalizeLocalDisplayName(input.localDisplayName);
  if (input.googleAvatarUrl || googleName) {
    return {
      displayName: googleName || localName || undefined,
      avatarUrl: input.googleAvatarUrl,
    };
  }
  if (!localName) return {};
  return {
    displayName: localName,
    avatarUrl: buildLocalAvatarDataUrl(input.participantId, localName),
  };
}
