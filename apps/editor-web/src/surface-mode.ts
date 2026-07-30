import {resolveSurfaceMode, type SurfaceMode} from "@blocksync/classroom-access";

export type {SurfaceMode};

export function detectEditorSurfaceMode(
  pathname = typeof location === "undefined" ? "/" : location.pathname,
  basePath = typeof import.meta !== "undefined"
    ? String(import.meta.env?.BASE_URL ?? "/")
    : "/",
): SurfaceMode {
  return resolveSurfaceMode(pathname, basePath);
}
