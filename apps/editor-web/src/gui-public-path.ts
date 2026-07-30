/**
 * Absolute public path for Scratch GUI webpack assets and blocks-media.
 *
 * Must NOT be derived from `location.pathname` via `new URL("./", location)`.
 * On student links (`/s/{token}`) that relative resolution becomes `/s/…`
 * and breaks green-flag / turn / zoom icons (404 under `/s/static/…`).
 */
export function normalizeGuiPublicPath(base: string | undefined | null): string {
  const raw = (base ?? "/").trim() || "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** Vite `import.meta.env.BASE_URL` (Railway: `/`). */
export function guiPublicPathFromEnv(
  baseUrl: string | undefined = typeof import.meta !== "undefined"
    ? String(import.meta.env?.BASE_URL ?? "/")
    : "/",
): string {
  return normalizeGuiPublicPath(baseUrl);
}

/**
 * Scratch GUI `basePath` prop. Same absolute prefix as webpack publicPath.
 * Relative `"./"` follows the current route and breaks nested surfaces.
 */
export function scratchGuiBasePath(
  baseUrl: string | undefined = typeof import.meta !== "undefined"
    ? String(import.meta.env?.BASE_URL ?? "/")
    : "/",
): string {
  return guiPublicPathFromEnv(baseUrl);
}
